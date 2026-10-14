#!/usr/bin/env bash
# Sobe o BarberOS num VPS (Ubuntu) com Docker.
#   bash scripts/deploy.sh root@IP              producao: sistema + Postgres + Caddy (https) + backup
#   bash scripts/deploy.sh root@IP homolog      homologacao (testes): sistema + Postgres proprios, no mesmo VPS
# - Envia o codigo atual (sem .env local, node_modules nem .next).
# - Producao: antes de trocar qualquer coisa, faz um backup do banco; se ele falhar, o deploy para.
# - Na 1a vez: instala o Docker e cria o .env do servidor com senhas aleatorias.
# - Depois e so rodar de novo para atualizar (o .env, os backups e os sites extras do servidor ficam).
set -euo pipefail
ALVO="${1:?uso: bash scripts/deploy.sh usuario@ip [homolog]}"
AMBIENTE="${2:-producao}"
case "$AMBIENTE" in
  producao) DIR=/opt/barberos; COMPOSE=deploy/docker-compose.yml; EXEMPLO=deploy/env.producao.exemplo ;;
  homolog) DIR=/opt/barberos-homolog; COMPOSE=deploy/docker-compose.homolog.yml; EXEMPLO=deploy/env.homolog.exemplo ;;
  *) echo "ambiente desconhecido: $AMBIENTE (use 'homolog' ou nada para producao)"; exit 2 ;;
esac
cd "$(dirname "$0")/.."

PACOTE="$(mktemp -d)/barberos.tgz"
# Arquivos do projeto (versionados + novos, sem os ignorados), pulando os que nao existem mais no disco.
git ls-files -co --exclude-standard -z | while IFS= read -r -d "" f; do [ -e "$f" ] && printf '%s\0' "$f"; done | tar --null -T - -czf "$PACOTE"
echo ">> $AMBIENTE · pacote: $(du -h "$PACOTE" | cut -f1)"
scp -q "$PACOTE" "$ALVO:/tmp/barberos-$AMBIENTE.tgz"

ssh "$ALVO" DIR="$DIR" COMPOSE="$COMPOSE" EXEMPLO="$EXEMPLO" AMBIENTE="$AMBIENTE" bash -s <<'REMOTO'
set -euo pipefail
PROD=/opt/barberos
if ! command -v docker >/dev/null 2>&1; then
  echo ">> instalando Docker (script oficial get.docker.com)"
  if ! curl -fsSL https://get.docker.com | sh; then
    # Versao do Ubuntu nova demais para o script oficial: usa os pacotes do proprio Ubuntu.
    echo ">> script oficial falhou; instalando pelos pacotes do Ubuntu"
    apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq docker.io docker-compose-v2
    systemctl enable --now docker
  fi
fi
mkdir -p "$DIR/backups"

# ---- Producao: backup antes de trocar o codigo (e antes das migracoes que sobem com o sistema novo)
if [ "$AMBIENTE" = producao ] && [ -f "$DIR/.env" ] && [ -f "$DIR/deploy/docker-compose.yml" ]; then
  cd "$DIR"
  dc() { docker compose --env-file .env -f deploy/docker-compose.yml "$@"; }
  if dc ps --status running -q db 2>/dev/null | grep -q .; then
    nome="barberos-$(date +%Y%m%d-%H%M)-antes-do-deploy.sql.gz"
    echo ">> backup antes do deploy: backups/$nome"
    if ! { dc exec -T db pg_dump -U barberos barberos | gzip > "backups/$nome" && gzip -t "backups/$nome"; }; then
      rm -f "backups/$nome"
      echo "!! o backup antes do deploy falhou: nada foi trocado. Confira o banco (docker compose ps) e rode de novo."
      exit 1
    fi
    # Registro para o painel (banco antigo sem a tabela: segue sem registrar).
    dc exec -T db psql -U barberos -d barberos -q -v ON_ERROR_STOP=1 -v id="dp$(date +%s)" -v arquivo="$nome" \
      -v bytes="$(stat -c %s "backups/$nome")" >/dev/null 2>&1 <<'SQL' || true
INSERT INTO backups (id, tipo, arquivo, bytes, restaurado, conferencia, "foraDoServidor", erro)
VALUES (:'id', 'DEPLOY', :'arquivo', :'bytes', false, NULL, false, NULL);
SQL
  fi
fi

# Troca o codigo, mantendo o .env, os backups e os sites extras do Caddy (homologacao) do servidor
find "$DIR" -mindepth 1 -maxdepth 1 ! -name .env ! -name backups ! -name caddy-sites ! -name .senha-homolog -exec rm -rf {} +
tar -xzf "/tmp/barberos-$AMBIENTE.tgz" -C "$DIR" && rm -f "/tmp/barberos-$AMBIENTE.tgz"
cd "$DIR"
if [ ! -f .env ]; then
  cp "$EXEMPLO" .env
  sed -i "s|^DB_SENHA=$|DB_SENHA=$(openssl rand -hex 24)|; s|^SESSION_SECRET=$|SESSION_SECRET=$(openssl rand -hex 32)|" .env
  if [ "$AMBIENTE" = producao ]; then
    IP=$(curl -fsS https://api.ipify.org || hostname -I | awk '{print $1}')
    sed -i "s|^APP_URL=$|APP_URL=\"http://$IP\"|" .env
  fi
  chmod 600 .env
  echo ">> .env criado em $DIR/.env (confira e preencha o que faltar)"
fi
if [ "$AMBIENTE" = producao ]; then
  # Chave interna do WhatsApp nao oficial (Evolution): cria se faltar, inclusive em .env antigo.
  grep -q "^EVOLUTION_API_KEY=" .env || echo "EVOLUTION_API_KEY=" >> .env
  sed -i "s|^EVOLUTION_API_KEY=$|EVOLUTION_API_KEY=$(openssl rand -hex 24)|" .env
  # Pasta dos sites extras do Caddy: um arquivo so de comentario garante que o import sempre ache algo.
  mkdir -p caddy-sites && [ -f caddy-sites/00-vazio.caddy ] || echo "# sites extras (ex.: homolog.caddy)" > caddy-sites/00-vazio.caddy
  if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
    ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
  fi
fi

# Rede que o Caddy da producao divide com a homologacao.
docker network inspect barberos-proxy >/dev/null 2>&1 || docker network create barberos-proxy >/dev/null
docker compose --env-file .env -f "$COMPOSE" up -d --build
docker image prune -f >/dev/null

# ---- Homologacao: endereco e senha no Caddy da producao
if [ "$AMBIENTE" = homolog ]; then
  dominio=$(grep -E '^HOMOLOG_DOMINIO=' .env | cut -d= -f2- | tr -d '"' || true)
  if [ -z "$dominio" ]; then
    echo "!! HOMOLOG_DOMINIO vazio em $DIR/.env: a homologacao subiu, mas sem endereco. Preencha e rode de novo."
  elif [ ! -d "$PROD/caddy-sites" ]; then
    echo "!! a producao ainda nao tem a pasta caddy-sites: rode primeiro 'bash scripts/deploy.sh $USER@IP' (producao)."
  else
    if [ ! -f .senha-homolog ]; then
      openssl rand -base64 18 | tr -d '/+=' > .senha-homolog && chmod 600 .senha-homolog
      echo ">> senha nova de acesso a homologacao (usuario: homolog): $(cat .senha-homolog)"
    fi
    hash=$(docker run --rm caddy:2-alpine caddy hash-password --plaintext "$(cat .senha-homolog)")
    cat > "$PROD/caddy-sites/homolog.caddy" <<CADDY
# Homologacao (gerado por scripts/deploy.sh ... homolog). Senha em $DIR/.senha-homolog
$dominio {
	basic_auth {
		homolog $hash
	}
	header X-Robots-Tag "noindex, nofollow"
	encode zstd gzip
	reverse_proxy app-homolog:3000
}
CADDY
    (cd "$PROD" && docker compose --env-file .env -f deploy/docker-compose.yml exec -T caddy caddy reload --config /etc/caddy/Caddyfile) \
      && echo ">> homologacao no ar em https://$dominio (usuario homolog, senha em $DIR/.senha-homolog)"
  fi
fi
sleep 5
docker compose --env-file .env -f "$COMPOSE" ps
REMOTO
echo ">> pronto ($AMBIENTE)"
