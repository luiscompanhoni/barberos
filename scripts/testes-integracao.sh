#!/usr/bin/env bash
# Roda todos os testes de fluxo (npm run teste:<area>) contra o banco do DATABASE_URL e falha se algum quebrar
# (codigo de saida diferente de zero ou alguma linha "FALHOU"). Áreas com guardas próprias usam destinos separados.
# Uso: npm run teste:todos; destinos DATABASE_URL_* devem estar criados/migrados; RH e COMANDAS também precisam do seed.
set -uo pipefail
# Não executar outros fluxos antes de detectar a falta dos bancos exclusivos; nunca usar o banco genérico como fallback.
for variavel in DATABASE_URL_RH DATABASE_URL_COMANDAS; do
  if [ -z "${!variavel:-}" ]; then
    echo "FALHOU: informe $variavel para o banco local descartável exclusivo, migrado e com seed."
    exit 1
  fi
done
falharam=()
for t in $(node -e 'console.log(Object.keys(require("./package.json").scripts).filter((k) => k.startsWith("teste:") && k !== "teste:todos").join(" "))'); do
  if [ "$t" = "teste:rh" ]; then
    saida=$(DATABASE_URL="$DATABASE_URL_RH" npm run -s "$t" 2>&1)
  elif [ "$t" = "teste:comandas" ]; then
    saida=$(DATABASE_URL="$DATABASE_URL_COMANDAS" npm run -s "$t" 2>&1)
  elif [ "$t" = "teste:historico" ]; then
    saida=$(DATABASE_URL="${DATABASE_URL_HISTORICO:-}" npm run -s "$t" 2>&1)
  elif [ "$t" = "teste:agentes" ]; then
    saida=$(DATABASE_URL="${DATABASE_URL_AGENTES:-}" npm run -s "$t" 2>&1)
  elif [ "$t" = "teste:estudio:templates" ]; then
    saida=$(DATABASE_URL="${DATABASE_URL_ESTUDIO:-}" npm run -s "$t" 2>&1)
  elif [ "$t" = "teste:recrutamento:formularios" ]; then
    saida=$(DATABASE_URL="${DATABASE_URL_RECRUTAMENTO:-}" npm run -s "$t" 2>&1)
  elif [ "$t" = "teste:recrutamento:entrevistas" ]; then
    saida=$(DATABASE_URL="${DATABASE_URL_ENTREVISTAS:-}" npm run -s "$t" 2>&1)
  else
    saida=$(npm run -s "$t" 2>&1)
  fi
  codigo=$?
  if [ "$codigo" -ne 0 ] || grep -q '^FALHOU' <<<"$saida"; then
    echo "== $t: FALHOU"
    echo "$saida"
    falharam+=("$t")
  else
    echo "== $t: ok ($(grep -c '^OK' <<<"$saida") verificações)"
  fi
done
if [ ${#falharam[@]} -gt 0 ]; then
  echo "Falharam: ${falharam[*]}"
  exit 1
fi
echo "Todos os testes de fluxo passaram."
