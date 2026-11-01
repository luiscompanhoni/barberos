#!/usr/bin/env bash
# Publica a branch ja clonada somente na homologacao do BarberOS.
# Uso no VPS:
#   EXPECTED_COMMIT=<sha> bash scripts/deploy-homolog-local.sh
set -Eeuo pipefail

TARGET="/opt/barberos-homolog"
SOURCE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE="deploy/docker-compose.homolog.yml"
PACKAGE="/tmp/barberos-homolog-estudio.tgz"
EXPECTED_COMMIT="${EXPECTED_COMMIT:?informe EXPECTED_COMMIT}"

fail() {
  echo "ERRO: $*" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || fail "execute como root"
[ "$TARGET" = "/opt/barberos-homolog" ] || fail "alvo inesperado"
[ "$PACKAGE" = "/tmp/barberos-homolog-estudio.tgz" ] || fail "pacote inesperado"
[ -d "$TARGET" ] || fail "$TARGET nao existe"
[ "$(realpath "$TARGET")" = "/opt/barberos-homolog" ] || fail "caminho do alvo nao confere"
[ -f "$TARGET/.env" ] || fail "$TARGET/.env nao existe"
[ -f "$SOURCE/$COMPOSE" ] || fail "compose de homologacao nao encontrado"
[ -d "$SOURCE/.git" ] || fail "execute a partir do clone Git"

CURRENT_COMMIT="$(git -C "$SOURCE" rev-parse HEAD)"
[ "$CURRENT_COMMIT" = "$EXPECTED_COMMIT" ] || fail "commit inesperado: $CURRENT_COMMIT"

STAMP="$(date -u +%Y%m%d-%H%M%S)"
BACKUP="$TARGET/backups/$STAMP-antes-estudio"
mkdir -p "$BACKUP"

cd "$TARGET"
dc_old() {
  docker compose --env-file .env -f "$COMPOSE" "$@"
}

if dc_old ps --status running -q db 2>/dev/null | grep -q .; then
  echo ">> backup do banco de homologacao"
  dc_old exec -T db pg_dump -U barberos barberos | gzip > "$BACKUP/banco.sql.gz"
  gzip -t "$BACKUP/banco.sql.gz" || fail "backup do banco invalido"
else
  echo ">> banco antigo nao estava em execucao; backup SQL nao se aplica"
fi

echo ">> backup do codigo atual"
tar --exclude=''./backups'' --exclude=''./.git'' -czf "$BACKUP/codigo.tgz" .
tar -tzf "$BACKUP/codigo.tgz" >/dev/null || fail "backup do codigo invalido"

echo ">> preparando codigo $CURRENT_COMMIT"
rm -f -- "$PACKAGE"
tar --exclude=''.git'' -C "$SOURCE" -czf "$PACKAGE" .
tar -tzf "$PACKAGE" >/dev/null || fail "pacote novo invalido"

echo ">> substituindo somente /opt/barberos-homolog"
find "$TARGET" -mindepth 1 -maxdepth 1 \
  ! -name .env ! -name backups ! -name caddy-sites ! -name .senha-homolog \
  -exec rm -rf -- {} +
tar -xzf "$PACKAGE" -C "$TARGET"
rm -f -- "$PACKAGE"

cd "$TARGET"
grep -q ''^ESTUDIO_HABILITADO='' .env || echo ''ESTUDIO_HABILITADO="true"'' >> .env
sed -i ''s/^ESTUDIO_HABILITADO=.*/ESTUDIO_HABILITADO="true"/'' .env
grep -q ''^ESTUDIO_WORKER_TOKEN='' .env || echo ''ESTUDIO_WORKER_TOKEN='' >> .env
if ! grep -Eq ''^ESTUDIO_WORKER_TOKEN=.{32,}$'' .env; then
  sed -i "s|^ESTUDIO_WORKER_TOKEN=.*|ESTUDIO_WORKER_TOKEN=$(openssl rand -hex 32)|" .env
fi
chmod 600 .env

docker network inspect barberos-proxy >/dev/null 2>&1 ||
  docker network create barberos-proxy >/dev/null

dc() {
  docker compose --env-file .env -f "$COMPOSE" "$@"
}

echo ">> validando compose"
dc config >/dev/null

echo ">> construindo aplicativo"
dc build app-homolog
echo ">> construindo processador de video"
dc build video-worker
echo ">> iniciando homologacao"
dc up -d

echo ">> aguardando saude do aplicativo"
healthy=false
for _ in $(seq 1 90); do
  app_id="$(dc ps -q app-homolog)"
  if [ -n "$app_id" ]; then
    state="$(docker inspect -f ''{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}'' "$app_id")"
    [ "$state" = "healthy" ] && healthy=true && break
    [ "$state" = "unhealthy" ] && break
  fi
  sleep 5
done
$healthy || {
  dc logs --no-color --tail=120 app-homolog >&2 || true
  fail "app-homolog nao ficou healthy"
}

for service in db app-homolog video-worker; do
  dc ps --status running -q "$service" | grep -q . || {
    dc logs --no-color --tail=120 "$service" >&2 || true
    fail "$service nao esta em execucao"
  }
done

app_id="$(dc ps -q app-homolog)"
docker exec "$app_id" wget -qO- http://127.0.0.1:3000/api/saude >/dev/null ||
  fail "endpoint /api/saude falhou"

dc exec -T db psql -U barberos -d barberos -tAc \
  "SELECT migration_name FROM _prisma_migrations WHERE migration_name=''20261025000000_estudio_black'' AND finished_at IS NOT NULL" |
  grep -qx ''20261025000000_estudio_black'' ||
  fail "migracao do Estudio Black nao confirmada"

echo ">> aguardando heartbeat do processador"
worker_ready=false
for _ in $(seq 1 24); do
  count="$(dc exec -T db psql -U barberos -d barberos -tAc "SELECT count(*) FROM estudio_workers WHERE \"vistoEm\" > now() - interval ''2 minutes''")"
  if [ "$count" -gt 0 ]; then
    worker_ready=true
    break
  fi
  sleep 5
done
$worker_ready || {
  dc logs --no-color --tail=120 video-worker >&2 || true
  fail "heartbeat do processador nao foi confirmado"
}

http_status="$(curl -sS -o /dev/null -w ''%{http_code}'' https://homolog.appblackbarber.com/ || true)"
case "$http_status" in
  200|401) ;;
  *) fail "endereco externo respondeu HTTP $http_status" ;;
esac

echo
echo "PUBLICACAO_CONCLUIDA"
echo "commit=$CURRENT_COMMIT"
echo "backup=$BACKUP"
echo "url=https://homolog.appblackbarber.com/estudio"
dc ps
