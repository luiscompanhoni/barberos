# Qualidade

## Comandos

| Comando | O que prova |
|---|---|
| `npm run lint` | ESLint com `eslint-config-next` (core-web-vitals + typescript) e as regras locais `quality/*` |
| `npm run lint:rules` | self-check das regras de `eslint-rules/` com o `RuleTester` do ESLint (`scripts/verify-quality-rules.mjs`) |
| `npm run typecheck` | `tsc --noEmit` em modo strict |
| `npm test` | testes unitários Vitest (`tests/*.test.ts`): regras puras, sem banco |
| `npm run teste:<área>` | testes de fluxo contra o banco do `.env`, com gateways falsos (ex.: `teste:comandas`, `teste:jogos`) |
| `npm run teste:todos` | todos os testes de fluxo (`scripts/testes-integracao.sh`, Git Bash) |
| `npm run build` | build de produção do Next |
| `npm run check` | lint, lint:rules, tipos, testes unitários e build, em sequência |

Durante o trabalho, rode o teste escopado (`npx vitest run tests/<arquivo>.test.ts` ou `npm run teste:<área>`). Antes de commit, `npm run check`; se a mudança mexe em banco, fluxo ou migration, também o `teste:<área>` correspondente. O CI (`.github/workflows/ci.yml`) roda tudo isso e ainda aplica as migrations num banco limpo, confere o schema e roda o seed.

## Regras de base

- TypeScript strict e presets oficiais do Next.
- **`quality/max-lines`** (error, 350 linhas). Testes, `.d.ts`, barrels e gerados ficam isentos. Baseline em `eslint.config.mjs` com os arquivos que já passavam do limite quando a regra entrou: `AberturaCaixa.tsx` (517), `pagarme.ts` (399), `CartaRaspavel.tsx` (376) e `scripts/teste-checkout.ts` (355, teste de integração). Ao dividir um deles, tire-o da lista; não acrescente arquivos novos à baseline.
- **`quality/no-direct-data-access`** (error em `src/components/**`): componentes não importam `db` de `@/lib/db`; usam `src/lib/<domínio>` no servidor ou uma rota. Páginas e rotas de servidor podem usar o cliente.
- **`quality/no-direct-console`**: não ativada. O projeto não tem logger estruturado e usa `console.*` no servidor (66 ocorrências em 26 arquivos). Para ativar, primeiro crie e adote um logger (proposta separada). Enquanto isso, nunca logue segredos ou corpos completos de webhook.
- Prisma em vez de Drizzle: as guardas do toolkit contra update/delete sem `where` são do Drizzle e não se aplicam. No Prisma, `updateMany`/`deleteMany` exigem revisão manual, e toda migration SQL é lida antes de aplicar.
- Entradas validadas com zod nas rotas; erros de negócio com `ErroNegocio` (mensagem para o usuário, sem detalhes internos); valores em centavos inteiros.

## Estratégia de testes

- **Unitários (`tests/`):** regras puras e decisões (agenda, preços, conciliação, jogos, checkout etc.). Rodam sem banco.
- **Fluxo (`scripts/teste-*.ts`):** cenários de ponta a ponta contra um Postgres real, com gateways de pagamento e WhatsApp falsos. Cobrem idempotência, concorrência, permissões e estornos.
- Não existe suíte E2E de navegador. Telas são verificadas manualmente no dev server (`.claude/launch.json`, nome `barberos`).
- Teste comportamento, fronteiras e regressões; não escreva testes que só repetem a implementação.

## Revisão após implementação ou correção

Ao concluir um ciclo de implementação ou correção, sugira de 3 a 8 ciclos posteriores de code review, com quantidade proporcional ao risco, focos complementares e prompt de continuação preenchido. Essa faixa é convenção do projeto; revisões adicionais dependem de pedido do usuário.

Cada ciclo verifica o estado atual e o código conectado, registra achados com severidade, local e evidência e reavalia correções autorizadas com os checks afetados. Correções da mesma rodada não reiniciam a contagem. Termine com verificação integrada e riscos residuais, sem criar ciclos artificiais ou afirmar que uma quantidade de revisões prova ausência de bugs.

## Dependências e entrega

Auditoria de 15/10/2026 (`npm audit --omit=dev`): 5 alertas altos, nenhum crítico.

| Pacote | Advisory | Correção disponível | Situação |
|---|---|---|---|
| `next` 16.3.7 | cache poisoning SSG/ISR, SSRF no Image Optimization, vazamento de Draft Mode, metadados de imagem, endpoint MCP do dev server | `next@16.4.1` (minor) | **pendente de decisão**: atualizar, rodar `check` + `teste:todos` e fazer deploy |
| `prisma` / `@prisma/config` / `deepmerge-ts` | estouro de pilha ao mesclar objetos recursivos (config do CLI) | só downgrade para 6.12 | aceito: afeta o CLI com config local, não o app em execução |
| `source-map-js` (via `postcss`) | DoS com source maps indexados | `npm audit fix` | build apenas; corrigir junto da atualização do Next |

Lint e build aprovados não significam auditoria zerada. Checks são comandos explícitos: sem hooks Git, bloqueios de push ou exigência de branch. Atualize este documento junto dos scripts e regras que mudarem.
