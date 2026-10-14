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

PASTA=${BACKUP_PASTA:-/backups}
DIAS_LOCAL=${BACKUP_DIAS_LOCAL:-14}
DIAS_FORA=${BACKUP_DIAS_FORA:-30}
HORA=${BACKUP_HORA:-0300}
export PGHOST=${PGHOST:-db} PGUSER=${PGUSER:-barberos}
BANCO=${PGDATABASE:-barberos}
TESTE=barberos_teste_restauracao

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

# Restaura num banco descartavel e confere: mesmas tabelas, mesma ultima migracao e nada a menos do que
# o banco tinha logo antes da copia. Imprime o resumo; volta 1 se algo nao bater.
verificar() { # arquivo [clientes_antes] [atendimentos_antes]
  local arq=$1 cli_antes=${2:-0} ag_antes=${3:-0}
  dropdb --if-exists "$TESTE" 2>/dev/null
  createdb "$TESTE" || { echo "nao criou o banco de teste"; return 1; }
  if ! gunzip -c "$arq" | psql -d "$TESTE" -q -v ON_ERROR_STOP=1 >/tmp/restauracao.log 2>&1; then
    echo "a restauracao parou: $(tail -n 3 /tmp/restauracao.log | tr '\n' ' ' | cut -c1-200)"
    dropdb --if-exists "$TESTE"; return 1
  fi
  local sql_tabelas="select count(*) from information_schema.tables where table_schema = 'public'"
  local sql_migracao="select migration_name from _prisma_migrations where finished_at is not null order by migration_name desc limit 1"
  local tabelas clientes atendimentos migracao tabelas_vivo migracao_vivo
  tabelas=$(contar "$TESTE" "$sql_tabelas"); migracao=$(contar "$TESTE" "$sql_migracao")
  clientes=$(contar "$TESTE" "select count(*) from clientes"); atendimentos=$(contar "$TESTE" "select count(*) from agendamentos")
  tabelas_vivo=$(contar "$BANCO" "$sql_tabelas"); migracao_vivo=$(contar "$BANCO" "$sql_migracao")
  dropdb --if-exists "$TESTE"
  local resumo="${tabelas:-0} tabelas · ${clientes:-0} clientes · ${atendimentos:-0} atendimentos · migração ${migracao:-?}"
  if [ "${tabelas:-0}" != "${tabelas_vivo:-x}" ] || [ "${migracao:-}" != "${migracao_vivo:-x}" ] \
    || [ "${clientes:-0}" -lt "$cli_antes" ] || [ "${atendimentos:-0}" -lt "$ag_antes" ]; then
    echo "nao bateu com o banco ($resumo; banco: ${tabelas_vivo} tabelas, ${cli_antes} clientes, ${ag_antes} atendimentos, ${migracao_vivo})"
    return 1
  fi
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
  mkdir -p "$PASTA"
  nome="barberos-$(date +%Y%m%d-%H%M).sql.gz"; arq="$PASTA/$nome"
  # O que o banco tem agora: a copia restaurada nao pode ter menos.
  local cli_antes ag_antes
  cli_antes=$(contar "$BANCO" "select count(*) from clientes"); ag_antes=$(contar "$BANCO" "select count(*) from agendamentos")
  if pg_dump -d "$BANCO" | gzip > "$arq.tmp" && gzip -t "$arq.tmp"; then
    mv "$arq.tmp" "$arq"; bytes=$(stat -c %s "$arq")
    if conferencia=$(verificar "$arq" "${cli_antes:-0}" "${ag_antes:-0}"); then
      restaurado=true; log "ok: $nome ($bytes bytes) · restaurado e conferido: $conferencia"
    else
      erro="Restauração de teste falhou: $conferencia"; log "ERRO: $erro"; conferencia=""
    fi
    fora "$arq"; case $? in
      0) foraok=true; log "copia criptografada enviada para fora do servidor" ;;
      1) erro="${erro:+$erro · }Cópia fora do servidor falhou"; log "ERRO: copia fora do servidor falhou" ;;
    esac
  else
    rm -f "$arq.tmp"; erro="pg_dump falhou"; log "ERRO: pg_dump falhou"
  fi
  registrar "$tipo" "$nome" "$bytes" "$restaurado" "$conferencia" "$foraok" "$erro"
  find "$PASTA" -name "barberos-*.sql.gz" -mtime +"$DIAS_LOCAL" -delete
  [ -z "$erro" ]
}

case "${1:-loop}" in
  loop)
    log "rodando: backup todo dia as ${HORA:0:2}:${HORA:2:2}, $DIAS_LOCAL dias no servidor"
    # Servidor desligado na hora do backup (ou primeira subida): faz agora.
    if ! find "$PASTA" -name "barberos-*.sql.gz" -mtime -1 2>/dev/null | grep -q .; then
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
    dropdb --if-exists barberos_restaurado && createdb barberos_restaurado || exit 1
    gunzip -c "$arq" | psql -d barberos_restaurado -q -v ON_ERROR_STOP=1 >/dev/null || { log "ERRO na restauracao"; exit 1; }
    log "restaurado no banco barberos_restaurado (a producao nao foi tocada). Para trocar, siga o README (Restaurar um backup)." ;;
  *) echo "uso: backup.sh loop | agora | verificar ARQUIVO | restaurar ARQUIVO"; exit 2 ;;
esac
