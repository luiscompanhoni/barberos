#!/usr/bin/env bash
# Sobe o BarberOS num VPS (Ubuntu) com Docker: sistema + Postgres + Caddy (https) + backup.
# Uso (Git Bash, na pasta do projeto):   bash scripts/deploy.sh root@IP-DO-VPS
# - Envia o codigo atual (sem .env local, node_modules nem .next).
# - Na 1a vez: instala o Docker e cria /opt/barberos/.env com senhas aleatorias.
# - Depois e so rodar de novo para atualizar (o .env e os backups do servidor ficam).
set -euo pipefail
ALVO="${1:?uso: bash scripts/deploy.sh usuario@ip}"
DIR=/opt/barberos
cd "$(dirname "$0")/.."

PACOTE="$(mktemp -d)/barberos.tgz"
# Arquivos do projeto (versionados + novos, sem os ignorados), pulando os que nao existem mais no disco.
git ls-files -co --exclude-standard -z | while IFS= read -r -d "" f; do [ -e "$f" ] && printf '%s\0' "$f"; done | tar --null -T - -czf "$PACOTE"
echo ">> pacote: $(du -h "$PACOTE" | cut -f1)"
scp -q "$PACOTE" "$ALVO:/tmp/barberos.tgz"

ssh "$ALVO" DIR="$DIR" bash -s <<'REMOTO'
set -euo pipefail
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
# Troca o codigo, mantendo .env e backups do servidor
find "$DIR" -mindepth 1 -maxdepth 1 ! -name .env ! -name backups -exec rm -rf {} +
tar -xzf /tmp/barberos.tgz -C "$DIR" && rm -f /tmp/barberos.tgz
cd "$DIR"
if [ ! -f .env ]; then
  cp deploy/env.producao.exemplo .env
  sed -i "s|^DB_SENHA=$|DB_SENHA=$(openssl rand -hex 24)|; s|^SESSION_SECRET=$|SESSION_SECRET=$(openssl rand -hex 32)|" .env
  IP=$(curl -fsS https://api.ipify.org || hostname -I | awk '{print $1}')
  sed -i "s|^APP_URL=$|APP_URL=\"http://$IP\"|" .env
  chmod 600 .env
  echo ">> .env criado em $DIR/.env (preencha DONO_TELEFONE, ANTHROPIC_API_KEY...)"
fi
# Chave interna do WhatsApp nao oficial (Evolution): cria se faltar, inclusive em .env antigo.
grep -q "^EVOLUTION_API_KEY=" .env || echo "EVOLUTION_API_KEY=" >> .env
sed -i "s|^EVOLUTION_API_KEY=$|EVOLUTION_API_KEY=$(openssl rand -hex 24)|" .env
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
fi
docker compose --env-file .env -f deploy/docker-compose.yml up -d --build
docker image prune -f >/dev/null
sleep 5
docker compose --env-file .env -f deploy/docker-compose.yml ps
REMOTO
echo ">> pronto"
