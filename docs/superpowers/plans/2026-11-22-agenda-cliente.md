# Plano de implementação da agenda do cliente

> **Execução:** seguir superpowers:subagent-driven-development. As etapas usam caixas de seleção.

**Objetivo.** Validar a agenda direta e documentar o teste seguro no iPhone.

**Arquitetura.** Preservar o destino no proxy, no layout do cliente e no formulário de entrada. Usar PostgreSQL sintético e o modo de código local.

**Stack.** Next.js, Prisma, Vitest e Vercel agent-browser.

**Especificação.** `docs/superpowers/specs/2026-11-22-agenda-cliente-design.md`.

## Restrições globais

- Somente a worktree `BarberOS-crescimento-20261122` e a branch `crescimento/dezembro-20261122`.
- Produção por GET sem sessão. Banco local com backup. Envios WhatsApp bloqueados, gateways simulados e viewport 390×844.
- Parar no resumo anterior à confirmação. Registrar horários no fuso America/Sao_Paulo.

## Focos de revisão

- Sessão anônima conserva o destino e o modo código.
- Troca depois de sessão de equipe conserva o destino na mesma aba.
- OTP local de ficha importada entra pelo papel CLIENTE.
- O link da vitrine leva à entrada da área.
- O teste de navegação não cria reserva.

### Task 1: Integração e prova da agenda

**Arquivos.** `src/proxy.ts`, `src/app/c/(area)/layout.tsx`, `src/components/login/FormularioLogin.tsx` e `src/app/assine/page.tsx` para leitura. Testes em `tests/agenda-retorno-login.test.ts` e `tests/login-entrada-ui.test.ts`. Entrega em `RESULTADO-AGENDA.md`.

- [x] Conferir `/api/saude`, ancestralidade de `919899a` e URL final do GET em navegador limpo.
- [x] Testar os três casos de entrada local, escolher Corte, um barbeiro e um horário livre. Conferir o botão de confirmação e a quantidade de reservas antes e depois.
- [x] Quando houver regressão, escrever teste que falhe e corrigir a camada responsável. Rodar testes de entrada, agenda e merge.
- [x] Revisar evidência e registrar o resultado da agenda em commit próprio antes das tarefas seguintes.
