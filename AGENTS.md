<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# BarberOS

Sistema de gestão da barbearia Black: agenda, comandas, assinaturas, pagamentos, financeiro e conciliação, campanhas no WhatsApp, jogos de recompensa e área do cliente.

## Produto e stack

- Escopo e módulos: `PRODUCT.md`. Estrutura e decisões: `docs/architecture.md`. Pendências: `docs/pendencias.md`.
- Stack: Next.js 16.3 (App Router) + React 19.2, TypeScript strict, Prisma 6.19 + PostgreSQL 16, Tailwind 4, zod 4, Vitest 5, tsx. Node 24, npm 11 (`package-lock.json`).
- Produção: VPS com docker compose (app, db, caddy, backup, evolution). Deploy só com pedido: `bash scripts/deploy.sh <usuario>@<host>`, que faz backup antes.
- Setup das ferramentas de IA e evidências: `docs/setup.md`.

## Comandos canônicos

- Instalar: `npm ci`
- Desenvolver: `npm run dev` (precisa de Postgres e `.env`; ver `docs/onboarding.md`)
- Lint: `npm run lint`
- Tipos: `npm run typecheck`
- Regras locais de lint: `npm run lint:rules` (self-check de `eslint-rules/`)
- Testes unitários: `npm test`; um arquivo: `npx vitest run tests/<arquivo>.test.ts`
- Testes de fluxo (banco do `.env`, gateways falsos): `npm run teste:<área>`; todos: `npm run teste:todos` (Git Bash)
- Build: `npm run build`
- Verificar base: `npm run check` (lint, lint:rules, tipos, testes unitários e build)
- Migração nova: `npm run db:migrate` (só no banco local; produção aplica no deploy)

## Acordos de trabalho

- Leia código e instruções pertinentes antes de editar. Declare hipóteses que alterem comportamento ou escopo.
- Complete o pedido com a menor mudança suficiente. Reutilize padrões, componentes e dependências existentes.
- Preserve alterações locais, validação, tratamento de erros, segurança, acessibilidade e requisitos explícitos.
- Não crie abstrações, arquitetura, opções, dependências ou funcionalidades para necessidades não solicitadas.
- Execute checks adequados. Teste lógica relevante e regressões; mudanças triviais não precisam de testes que apenas reproduzem a implementação.
- Não transforme hipóteses em fatos ou integrações pendentes em resultados simulados.
- Continue trabalho já autorizado. Pergunte somente por informação indispensável ou por ação fora da autorização.
- Commit, deploy, publicação, mensagens a terceiros (WhatsApp, e-mail), custos e ações destrutivas dependem de pedido explícito. Instalar ferramentas não concede essa autorização.
- Nunca repita segredos (chaves de API, tokens, `.env`) em respostas, commits ou docs; segredos de produção ficam no `.env` do servidor.
- Commits sem trailer `Co-Authored-By`. Não versione `.claude-flow/`.

## Continuidade de execução

- Durante trabalho autorizado, responda a perguntas de status e retome as ações restantes. Pare se o usuário pedir pausa, cancelar ou mudar o objetivo.
- Um bloqueio impede só tarefas dependentes. Conclua as independentes que ainda forem seguras e autorizadas.
- Se um agente falhar ou ficar com estado incerto, confirme que parou antes de assumir seus arquivos; retome do ponto verificado, sem escritores concorrentes.
- Não repita tentativa idêntica sem evidência nova. Decisões anteriores não ampliam autorização.
- Ao retomar por handoff, confira arquivos, Git, checks e processos reais.
- Sem alternativa segura, informe o bloqueio, o concluído e o que falta; não apresente pendência como resultado.

## Padrões e documentação

- Persistência: **Prisma + PostgreSQL** (exceção ao default Drizzle do toolkit, registrada em `PRODUCT.md`). Não migre de ORM. Migrations SQL em `prisma/migrations/`, revisadas antes de aplicar; produção aplica `prisma migrate deploy` no deploy, nunca no build ou por request.
- Cliente único `db` em `@/lib/db`. Regra de negócio em `src/lib/<domínio>/`; rotas (`src/app/api/**/route.ts`) e páginas de servidor chamam esses módulos. Componentes em `src/components/` não importam `@/lib/db` (o lint barra).
- Valide entradas com zod nas rotas. Erros de negócio com `ErroNegocio`/`naoEncontrado` (`@/lib/erros`); ações sensíveis registram `auditar(...)` na mesma transação.
- Dinheiro em centavos inteiros (`*Centavos`); horário de referência America/Sao_Paulo. Operações com efeito externo têm chave de idempotência.
- Logs: hoje `console.*` no servidor (não há logger estruturado; ver `docs/quality.md`). Nunca logue segredos ou corpos completos de webhooks.
- Consulte fontes oficiais atuais (Context7 ou `node_modules/next/dist/docs/`) antes de alterar APIs do Next/Prisma. Não migre versões principais automaticamente.
- Documento responsável: `PRODUCT.md` (escopo), `docs/architecture.md` (estrutura, integrações, operação), `docs/design.md` (interface), `docs/onboarding.md` (preparação), `docs/quality.md` (checks), `docs/pendencias.md` (o que falta). Atualize junto da mudança, sem duplicar regras.

## Ferramentas e estilo

- **Ponytail:** plugin instalado (usuário), intensidade `full` para programação. `stop ponytail` desativa.
- **Caveman:** conversa concisa em português, preservando clareza e explicações completas quando pedidas. Código, docs e commits com redação normal. `stop caveman` desativa.
- **Superpowers:** use skills pertinentes, proporcionais ao escopo. Instruções explícitas e execução já autorizada prevalecem sobre aprovações repetidas.
- **Context7:** documentação atual de APIs e bibliotecas. Um conceito por consulta. Nunca envie segredos, código privado ou dados de clientes.
- **RTK:** hook global ativo no Bash (reescreve comandos suportados). Não prefixe `rtk` manualmente; use `rtk proxy <comando>` para saída original. No Windows, padrões com curinga entre aspas (`find -name "*.md"`, `--include="*.ts"`) podem ser expandidos indevidamente: prefira as ferramentas Glob/Grep.
- **Graphify:** grafo só de código em `graphify-out/` (fora do Git). Use para perguntas de estrutura (`graphify explain "<símbolo>"`, `graphify path "A" "B"`); regenere com `graphify extract . --code-only --no-cluster` e trate o grafo como possivelmente desatualizado.
- **Ruflo:** plugins e hooks do usuário (memória, roteamento). Não substituem os checks do projeto.
- **Navegador:** navegador do app para o dev server (`.claude/launch.json`, nome `barberos`) e Claude in Chrome para sessões logadas do usuário; nunca digite senhas.
- **LLMs:** preserve cliente, modelo principal e autenticação. Não ative API paga ou proxy silenciosamente.

Confira instalação antes de depender de uma ferramenta; ausência precisa de registro ou alternativa.

## Skills para Next.js

Instaladas no projeto em `.claude/skills/` (cópias, `skills-lock.json`):

- `vercel-react-best-practices`: ao escrever/revisar React/Next, dados e desempenho.
- `vercel-composition-patterns`: decisões concretas de composição e API de componentes.
- `web-design-guidelines`: revisão de interface e acessibilidade.
- `writing-guidelines`: revisão de documentação e prosa.
- `vercel-react-view-transitions`: transições pedidas e compatíveis com as versões.
- `find-skills`: descoberta quando faltar uma capacidade concreta.

Não instaladas por não se aplicarem (o deploy é no VPS, não na Vercel): `deploy-to-vercel`, `vercel-cli-with-tokens`, `vercel-optimize`. Instalar skills não executa suas ações.

## Git e colaboração

- Trabalho direto na `main` é o fluxo atual; PRs quando pedidos. Sem hooks `pre-commit`/`pre-push` ou bloqueios de branch por padrão.
- O CI (`.github/workflows/ci.yml`) roda tipos, lint, `lint:rules`, testes, migrações num banco limpo, seed, testes de fluxo e build.
- Delegue quando pedido ou pelo fluxo pertinente. Tarefas paralelas precisam de arquivos distintos.

## Delegação e revisão

- Delegue só quando isolamento de contexto, especialização ou paralelismo independente compensarem a coordenação.
- Política de modelos: sem política autorizada, subagentes usam o modelo da sessão. Busca e inventário podem usar capacidade leve; segurança, dados financeiros, migrations e revisão crítica usam capacidade suficiente.
- Cada tarefa recebe objetivo, contexto mínimo, arquivos permitidos, aceite e checks. Um escritor por arquivo; o coordenador cuida de lockfiles, configuração e integração. Revisores paralelos só leem.
- Verifique diff e checks antes de aceitar o resultado de um trabalhador.
- Após cada ciclo de implementação ou correção, sugira de **3 a 8 ciclos de code review** conforme risco e escopo, com motivo e prompt copiável (número, focos e checks reais). A sugestão não autoriza executar as rodadas.
- Em rodada pedida, cada ciclo revisa o estado atual, registra achados com severidade/local/evidência e verifica correções. Correções internas não reiniciam a contagem; termine com revisão de integração e riscos residuais.

## Convenções e contexto

- Imports absolutos `@/` (= `src/`). Nomes de domínio em português sem acento em identificadores (`agendamento`, `comanda`, `valorCentavos`); textos de interface com acento.
- Comentários curtos, em português, explicando o porquê. Arquivos até 350 linhas (`quality/max-lines`; baseline em `eslint.config.mjs`).
- Scripts avulsos de produção: empacotar com esbuild e rodar no container (ver `docs/architecture.md`, Operação).
