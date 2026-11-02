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
| `npm run teste:historico` | correções, estorno histórico, auditoria, bloqueios e concorrência num PostgreSQL local descartável |
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
- `npm run teste:evolucao`: cria/migra bancos locais `barberos_test_*` e executa oito fluxos: acessos, agenda, reuniões, avaliações, recompra, desempenho, notificações e geração de avisos. Exige PostgreSQL local com permissão de criar bancos; força provedores simulados e não usa dados da barbearia. Também roda em `teste:todos`. O fluxo de notificações substitui o transporte antes de testar respostas do provedor; nenhum caso usa push real.
- Não existe suíte E2E de navegador versionada. Telas são verificadas manualmente no dev server (`.claude/launch.json`, nome `barberos`).
- Teste comportamento, fronteiras e regressões; não escreva testes que só repetem a implementação.

### Correção histórica Celcash

`teste:historico` exige `DATABASE_URL` apontando para localhost/127.0.0.1 e banco
`barberos_historico_teste`, previamente criado e migrado. Não usa o banco comum de desenvolvimento.
Substitui a consulta Celcash por respostas fictícias e recusa outros destinos ou métodos de rede.
Os metadados de backup são fixtures; não comprovam um backup real. Deixa os dados sintéticos no banco
descartável para inspeção, pois a auditoria é imutável. O CI executa esse fluxo em banco separado.
Em `teste:todos`, informe esse destino em `DATABASE_URL_HISTORICO`; o runner troca `DATABASE_URL`
somente para `teste:historico`. Ausência ou destino inválido falham, sem recorrer ao banco comum.
Os testes unitários cobrem identidade, datas, duplicidade, escopo de leitura, schema e acesso à rota.
O fluxo inclui repetição com payload alterado, disputa com pedido normal de estorno, trava da importação
de extrato, preservação de nota concorrente, rollback por falha de auditoria, total líquido do estorno,
benefícios atuais e alerta para mudança posterior na fonte. Não comprova acesso nem valores de produção.

### Validação da evolução da equipe — 28/10/2026

- `npm run check` passou: lint, regras locais, TypeScript, 402 testes unitários em 51 arquivos e build de produção.
- `npm run teste:todos` passou nas 18 suítes, usando PostgreSQL local com dados sintéticos e provedores simulados.
  A suíte `teste:evolucao` executa seis módulos; foi repetida após os ajustes finais das regras de negócio.
- As 42 migrações foram aplicadas em banco vazio. `prisma migrate diff` entre o banco migrado e o schema não
  encontrou diferenças. `git diff --check` passou.
- Chromium verificou reuniões/slides, edição de função, revogação na sessão aberta, seleção de intervalo e
  bloqueio, encaixes, projeção combinada, presença sem agenda e avaliação com nota baixa/recompensa única.
  Telas em computador e celular não tiveram erros de execução nem transbordamento horizontal nos cenários
  verificados. Os roteiros usados nessa conferência local não constituem uma suíte E2E versionada.

Esses resultados validam a implementação local; não comprovam publicação, canais reais ou uso em aparelho físico.

### Aplicativo e notificações — 28/10/2026

- `npm run check` passou: lint, regras locais, TypeScript, unitários e build de produção.
- 486 testes unitários em 57 arquivos: inclui validação de endpoints/chaves, classificação de erros, ausência de transporte em homologação, destinos seguros, cache público, inscrição/rotação VAPID e geração por categoria.
- `npm run teste:todos` passou nas 18 suítes em banco local sintético; `teste:evolucao` agora cobre oito módulos. O fluxo de notificações passou novamente após o ajuste de tipos do próprio teste. Verifica isolamento, preferências, concorrência, revogação, 410, timeout sem reenvio, 429 e limites do teste. A geração possui 34 verificações em banco isolado.
- 43 migrações aplicadas, incluindo execução em bancos novos do runner. Comparação do schema com o banco migrado sem diferenças; `git diff --check` limpo.
- Chromium/Playwright verificou centrais cliente/equipe, metadados, gesto de instalação emulado, simulação de aviso, leitura, preferências, instruções de iPhone, isolamento entre contas, bloqueio de origem externa, cookie HttpOnly, revogação por logout e troca de conta. Offline usou apenas o fallback público. Layouts de computador/celular sem transbordamento horizontal nem erro JavaScript nos cenários executados.
- O navegador recebeu inscrições sintéticas para testar a API; não houve registro em provedor externo nem envio real. Instalação física, permissão do sistema operacional e entrega com o aplicativo fechado ainda exigem validação após publicação. Os roteiros de navegador permanecem fora da suíte versionada.

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
