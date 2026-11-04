#!/usr/bin/env bash
# Somente runner Linux descartável, sem acesso à VPS.
set -euo pipefail
raiz=${1:?Informe a raiz da cópia revisada}
experimento=${2:?Informe o diretório deste experimento}
app=${3:?Informe a tag local da imagem de app}
worker=${4:?Informe a tag local da imagem de worker}
temporario=$(mktemp -d)
trap 'rm -rf -- "$temporario"' EXIT

docker build -t barberos-backup-experimento:anterior -f "$raiz/deploy/backup.Dockerfile" "$raiz/deploy"
docker build -t barberos-backup-experimento:cliente -f "$experimento/Dockerfile" "$raiz/deploy"
python3 "$experimento/teste.py" barberos-backup-experimento:anterior
python3 "$experimento/teste.py" barberos-backup-experimento:cliente
for variante in anterior cliente; do
  imagem="barberos-backup-experimento:$variante"
  docker image inspect "$imagem" --format '{{.Size}}' > "$temporario/$variante-imagem"
  docker save "$app" "$imagem" "$worker" | tee >(wc -c > "$temporario/$variante-tar") | gzip -1 | wc -c > "$temporario/$variante-gzip"
  wait
  printf '%s imagem=%s tar=%s gzip=%s bytes\n' "$variante" "$(cat "$temporario/$variante-imagem")" "$(cat "$temporario/$variante-tar")" "$(cat "$temporario/$variante-gzip")"
done
