#!/usr/bin/env bash
# Backup do banco do BarberOS. Roda no container "backup" (deploy/docker-compose.yml).
#
#   backup.sh loop                 todo dia na BACKUP_HORA (padrao 0300): copia, restauracao de teste e copia fora
#                                  (se o servidor estava desligado na hora, faz assim que subir)
#   backup.sh agora                faz um backup completo agora (com restauracao de teste)
#   backup.sh verificar ARQUIVO    restaura ARQUIVO num banco temporario, confere e apaga
#   backup.sh restaurar ARQUIVO    restaura ARQUIVO no banco "barberos_restaurado" (a producao nao e tocada)
#
# Cada backup fica registrado na tabela "backups" (o painel do dono mostra o ultimo e avisa se atrasar ou falhar).
# Copia fora do servidor: so com BACKUP_S3_* e BACKUP_SENHA (o arquivo sobe criptografado com AES-256).
set -uo pipefail
umask 077

PASTA=${BACKUP_PASTA:-/backups}
DIAS_LOCAL=${BACKUP_DIAS_LOCAL:-14}
DIAS_FORA=${BACKUP_DIAS_FORA:-30}
HORA=${BACKUP_HORA:-0300}
export PGHOST=${PGHOST:-db} PGUSER=${PGUSER:-barberos}
BANCO=${PGDATABASE:-barberos}
MIDIAS=${BACKUP_ESTUDIO_MEDIA:-}
SCRIPT_MIDIAS="$(dirname "${BASH_SOURCE[0]}")/backup-estudio.py"
SCRIPT_MANIFESTO="$(dirname "${BASH_SOURCE[0]}")/backup-manifesto.py"

log() { echo "[backup] $(date '+%Y-%m-%d %H:%M:%S') $*"; }
contar() { psql -d "$1" -tAc "$2" 2>/dev/null | tr -d '[:space:]'; }

# Grava o resultado na tabela "backups" (banco antigo sem a tabela: so avisa no log).
registrar() { # tipo arquivo bytes restaurado conferencia fora erro
  psql -d "$BANCO" -q -v ON_ERROR_STOP=1 \
    -v id="bk$(date +%s)$RANDOM" -v tipo="$1" -v arquivo="$2" -v bytes="$3" -v restaurado="$4" \
    -v conferencia="$5" -v fora="$6" -v erro="$7" >/dev/null 2>&1 <<'SQL' || log "aviso: nao deu para registrar na tabela backups"
INSERT INTO backups (id, tipo, arquivo, bytes, restaurado, conferencia, "foraDoServidor", erro)
VALUES (:'id', :'tipo', :'arquivo', :'bytes', :'restaurado', NULLIF(:'conferencia', ''), :'fora', NULLIF(:'erro', ''));
SQL
}

# Restaura num banco descartável e compara todas as linhas/schema ao snapshot do dump.
# Nunca compara um backup antigo ao banco vivo atual.
verificar() { # arquivo [criar|verificar]
  local arq=$1 modo=${2:-verificar} midias="" resumo=""
  local TESTE="barberos_teste_$(date +%s)_$RANDOM"
  createdb "$TESTE" || { echo "nao criou o banco de teste"; return 1; }
  if ! gunzip -c "$arq" | psql -X -d "$TESTE" -q -v ON_ERROR_STOP=1 >/dev/null 2>&1; then
    echo "a restauracao do banco falhou; detalhes privados nao foram exibidos"
    dropdb --if-exists "$TESTE"; return 1
  fi
  if ! resumo=$(python3 "$SCRIPT_MANIFESTO" verificar "$TESTE" "$arq" "${arq%.sql.gz}.manifesto.json" 2>/dev/null); then
    echo "conteúdo, schema ou auditoria não correspondem ao snapshot; manifesto obrigatório"
    dropdb --if-exists "$TESTE" >/dev/null
    return 1
  fi
  if [ -n "$MIDIAS" ]; then
    if ! midias=$(python3 "$SCRIPT_MIDIAS" "$modo" "$arq" "$TESTE" "${arq%.sql.gz}.studio.tar.gz" "$MIDIAS" 2>/dev/null); then
      dropdb --if-exists "$TESTE" >/dev/null
      echo "a restauracao das midias falhou; conferir volume, referencias, integridade e espaco livre"
      return 1
    fi
    resumo="$resumo · $midias"
  elif ! python3 "$SCRIPT_MIDIAS" exigir-vazio "$arq" "$TESTE" - >/dev/null 2>&1; then
    dropdb --if-exists "$TESTE" >/dev/null
    echo "banco possui midias ou nao pode ser conferido; configure BACKUP_ESTUDIO_MEDIA com o volume correto"
    return 1
  fi
  dropdb --if-exists "$TESTE" >/dev/null || return 1
  echo "$resumo"
}

# Copia criptografada para um armazenamento S3 (Backblaze B2, Cloudflare R2, AWS...). 0 = foi, 1 = falhou, 2 = desligada.
fora() { # arquivo
  [ -n "${BACKUP_S3_BUCKET:-}" ] || return 2
  if [ -z "${BACKUP_SENHA:-}" ]; then log "BACKUP_SENHA vazia: a copia fora do servidor precisa ser criptografada"; return 1; fi
  local cripto="/tmp/$(basename "$1").enc"
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_SENHA -in "$1" -out "$cripto" || return 1
  export RCLONE_CONFIG_FORA_TYPE=s3 RCLONE_CONFIG_FORA_PROVIDER="${BACKUP_S3_PROVEDOR:-Other}" \
    RCLONE_CONFIG_FORA_ACCESS_KEY_ID="${BACKUP_S3_CHAVE:-}" RCLONE_CONFIG_FORA_SECRET_ACCESS_KEY="${BACKUP_S3_SEGREDO:-}" \
    RCLONE_CONFIG_FORA_ENDPOINT="${BACKUP_S3_ENDPOINT:-}" RCLONE_CONFIG_FORA_REGION="${BACKUP_S3_REGIAO:-auto}" \
    RCLONE_CONFIG_FORA_NO_CHECK_BUCKET=true
  local destino="fora:${BACKUP_S3_BUCKET}/barberos"
  rclone copyto "$cripto" "$destino/$(basename "$cripto")" --retries 3 -q; local r=$?
  rm -f "$cripto"
  [ $r -eq 0 ] || return 1
  rclone delete "$destino" --min-age "${DIAS_FORA}d" -q || log "aviso: nao apagou as copias antigas fora do servidor"
  return 0
}

backup() { # tipo
  local tipo=${1:-MANUAL} nome arq bytes=0 erro="" conferencia="" restaurado=false foraok=false
  mkdir -p "$PASTA" || return 1
  exec 9>"$PASTA/.backup.lock"
  flock -n 9 || { log "outro backup esta em andamento"; return 1; }
  nome="barberos-$(date +%Y%m%d-%H%M%S)-$RANDOM.sql.gz"; arq="$PASTA/$nome"
  local manifesto="${arq%.sql.gz}.manifesto.json"
  # pg_dump e hashes de todas as tabelas compartilham um snapshot exportado.
  if python3 "$SCRIPT_MANIFESTO" criar "$BANCO" "$arq.tmp" "$manifesto.tmp" 2>/dev/null && gzip -t "$arq.tmp"; then
    mv "$arq.tmp" "$arq"; mv "$manifesto.tmp" "$manifesto"
    bytes=$(($(stat -c %s "$arq") + $(stat -c %s "$manifesto")))
    if conferencia=$(verificar "$arq" criar); then
      if [ -n "$MIDIAS" ]; then bytes=$((bytes + $(stat -c %s "${arq%.sql.gz}.studio.tar.gz"))); fi
      restaurado=true; log "ok: $nome ($bytes bytes) · restaurado e conferido: $conferencia"
    else
      erro="Restauração de teste falhou: $conferencia"; log "ERRO: $erro"; conferencia=""
    fi
    if [ "$restaurado" = true ]; then
      fora "$arq"; local enviado=$?
      if [ "$enviado" -eq 0 ]; then fora "$manifesto"; enviado=$?; fi
      if [ "$enviado" -eq 0 ] && [ -n "$MIDIAS" ]; then fora "${arq%.sql.gz}.studio.tar.gz"; enviado=$?; fi
      case $enviado in
        0) foraok=true; log "copia criptografada enviada para fora do servidor" ;;
        1) erro="${erro:+$erro · }Cópia fora do servidor falhou"; log "ERRO: copia fora do servidor falhou" ;;
      esac
    fi
  else
    rm -f "$arq.tmp" "$manifesto.tmp"; erro="pg_dump ou manifesto consistente falhou"; log "ERRO: pg_dump ou manifesto falhou"
  fi
  registrar "$tipo" "$nome" "$bytes" "$restaurado" "$conferencia" "$foraok" "$erro"
  if [ -z "$erro" ] && [ "$restaurado" = true ]; then
    while IFS= read -r -d '' antigo; do
      rm -f -- "$antigo" "${antigo%.sql.gz}.studio.tar.gz" "${antigo%.sql.gz}.manifesto.json"
    done < <(find "$PASTA" -type f -name "barberos-*.sql.gz" -mtime +"$DIAS_LOCAL" -print0)
  fi
  flock -u 9
  [ -z "$erro" ]
}

case "${1:-loop}" in
  loop)
    log "rodando: backup todo dia as ${HORA:0:2}:${HORA:2:2}, $DIAS_LOCAL dias no servidor"
    # Servidor desligado na hora do backup (ou primeira subida): faz agora.
    padrao='barberos-*.sql.gz'; [ -z "$MIDIAS" ] || padrao='barberos-*.studio.tar.gz'
    if ! find "$PASTA" -name "$padrao" -mtime -1 2>/dev/null | grep -q .; then
      until pg_isready -q -d "$BANCO"; do sleep 5; done
      backup DIARIO
    fi
    while true; do
      if [ "$(date +%H%M)" = "$HORA" ]; then backup DIARIO; sleep 60; fi
      sleep 30
    done ;;
  agora) backup "${2:-MANUAL}" ;;
  verificar)
    arq=${2:?informe o arquivo}
    if r=$(verificar "$arq"); then log "ok: $r"; else log "ERRO: $r"; exit 1; fi ;;
  restaurar)
    arq=${2:?informe o arquivo}
    createdb barberos_restaurado || { log "banco de destino indisponivel ou ja existe; nada foi apagado"; exit 1; }
    gunzip -c "$arq" | psql -X -d barberos_restaurado -q -v ON_ERROR_STOP=1 >/dev/null 2>&1 || { log "ERRO na restauracao; banco parcial preservado para inspecao"; exit 1; }
    python3 "$SCRIPT_MANIFESTO" verificar barberos_restaurado "$arq" "${arq%.sql.gz}.manifesto.json" || exit 1
    if [ -n "$MIDIAS" ]; then
      python3 "$SCRIPT_MIDIAS" restaurar "$arq" barberos_restaurado "${arq%.sql.gz}.studio.tar.gz" "${arq%.sql.gz}-midias-restauradas" || exit 1
      log "midias restauradas numa pasta nova ao lado do dump; volume de producao nao foi alterado"
    fi
    log "restaurado no banco barberos_restaurado (a producao nao foi tocada). Para trocar, siga o README (Restaurar um backup)." ;;
  *) echo "uso: backup.sh loop | agora | verificar ARQUIVO | restaurar ARQUIVO"; exit 2 ;;
esac
