#!/usr/bin/env bash
# Copia o banco da PRODUCAO para a HOMOLOGACAO, anonimizado (deploy/anonimizar.sql): para testar com dados parecidos
# com os de verdade sem expor cliente nem mandar nada para ninguem. A producao so e lida (pg_dump), nunca alterada.
# Sem a sessao do WhatsApp (schema evolution_api). Apaga o que estava na homologacao.
# Uso (Git Bash, na pasta do projeto):   bash scripts/homolog-copiar-producao.sh root@IP
set -euo pipefail
ALVO="${1:?uso: bash scripts/homolog-copiar-producao.sh usuario@ip}"
cd "$(dirname "$0")/.."
read -r -p "Apagar os dados da HOMOLOGACAO e trocar por uma copia anonimizada da producao? [s/N] " ok
[ "$ok" = "s" ] || [ "$ok" = "S" ] || { echo "cancelado"; exit 1; }
scp -q deploy/anonimizar.sql "$ALVO:/tmp/barberos-anonimizar.sql"

ssh "$ALVO" bash -s <<'REMOTO'
set -euo pipefail
PROD=/opt/barberos; HOMOLOG=/opt/barberos-homolog
[ -f "$HOMOLOG/.env" ] || { echo "!! homologacao nao instalada: rode antes 'bash scripts/deploy.sh root@IP homolog'"; exit 1; }
prod() { (cd "$PROD" && docker compose --env-file .env -f deploy/docker-compose.yml "$@"); }
homolog() { (cd "$HOMOLOG" && docker compose --env-file .env -f deploy/docker-compose.homolog.yml "$@"); }

echo ">> parando o sistema da homologacao"
homolog stop app-homolog
homolog exec -T db psql -U barberos -d postgres -q -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS barberos WITH (FORCE)" -c "CREATE DATABASE barberos"
echo ">> copiando a producao (so leitura)"
prod exec -T db pg_dump -U barberos --exclude-schema=evolution_api barberos | homolog exec -T db psql -U barberos -d barberos -q -v ON_ERROR_STOP=1 >/dev/null
echo ">> anonimizando"
homolog exec -T db psql -U barberos -d barberos -v ON_ERROR_STOP=1 < /tmp/barberos-anonimizar.sql
rm -f /tmp/barberos-anonimizar.sql
homolog start app-homolog
echo ">> pronto: a homologacao tem uma copia anonimizada da producao"
REMOTO
