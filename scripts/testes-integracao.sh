#!/usr/bin/env bash
# Roda todos os testes de fluxo (npm run teste:<area>) contra o banco do DATABASE_URL e falha se algum quebrar
# (codigo de saida diferente de zero ou alguma linha "FALHOU"). Histórico usa DATABASE_URL_HISTORICO.
# Uso: npm run teste:todos (local e no CI); ambos os bancos devem estar previamente migrados.
set -uo pipefail
falharam=()
for t in $(node -e 'console.log(Object.keys(require("./package.json").scripts).filter((k) => k.startsWith("teste:") && k !== "teste:todos").join(" "))'); do
  if [ "$t" = "teste:historico" ]; then
    saida=$(DATABASE_URL="${DATABASE_URL_HISTORICO:-}" npm run -s "$t" 2>&1)
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
