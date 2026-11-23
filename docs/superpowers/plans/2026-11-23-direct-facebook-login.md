# Plano de implementação do Direct com login do Facebook

> Executar com Superpowers Subagent-Driven Development.

**Objetivo.** Adaptar o Direct do Leonel ao app Black Barber Direct.

**Arquitetura.** Selecionar host, ID e token em `src/lib/instagram/provedor.ts`. Reaproveitar o webhook `instagram` e a persistência.

**Stack.** Next App Router, TypeScript, Zod, Vitest e PostgreSQL local.

**Especificação.** `docs/superpowers/specs/2026-11-23-direct-facebook-login-design.md`.

## Restrições globais

- Trabalhar na worktree e branch `crescimento/dezembro-20261122`. Commits locais em pt-BR.
- Usar só fixtures, serviços locais e PostgreSQL de teste. Preservar `WHATSAPP_ENVIOS_BLOQUEADOS=true` durante toda a execução. Sem envio externo, IA paga, alteração na Meta, deploy, push ou alteração em produção.
- Ausência de `INSTAGRAM_ENVIOS_BLOQUEADOS` e `AMBIENTE=homologacao` simulam. A quarentena mantém a proteção. IA paga exige a liberação explícita já existente.

## Focos da revisão

- O token de um provedor não pode autenticar o outro, mesmo com ambos no ambiente.
- Uma configuração inválida não pode chegar à rede.
- Um callback assinado pode conter eventos de outro perfil, um eco ou um callback `page`.
- Uma entrega duplicada durante processamento deve produzir um único turno.
- Uma confirmação incoerente da Meta deve falhar sem expor a resposta remota.

---

### Task 1: Transportes do Direct

**Arquivos.** Criar `src/lib/instagram/provedor.ts` e ajustar `src/lib/instagram/canal.ts`, `.env.example`, `tests/instagram-protocolo.test.ts` e `tests/instagram-webhook-rota.test.ts`.

**Interface.** `transporteInstagram(): { url: string; token: string } | null`, sem I/O. A assinatura de `enviarTextoInstagram` e o formato do callback seguem iguais.

- [ ] Fixar nos testes o envio padrão para `https://graph.facebook.com/v26.0/887766/messages`, com token de página fictício, o corpo com IGSID, sinal, ausência de tag e modo legado explícito. Cobrir configuração inválida, homologação, quarentena e confirmação divergente. Rodar e verificar as falhas antes da mudança.
- [ ] Resolver `INSTAGRAM_PROVEDOR`, `INSTAGRAM_PAGE_ID`, `INSTAGRAM_PAGE_ACCESS_TOKEN`, `INSTAGRAM_ACCESS_TOKEN` e `INSTAGRAM_GRAPH_API_VERSION` com validação. Atualizar o exemplo de ambiente. Manter a trava antes de montar a requisição.
- [ ] Cobrir no callback assinado os descartes e a ausência de turno extra ao repetir o `mid`. Rodar `npx --no-install vitest run tests/instagram-protocolo.test.ts tests/instagram-webhook-rota.test.ts`, conferir o diff e commitar.

### Task 2: Manual do app Meta

**Arquivo.** `docs/instagram-direct-leonel.md`.

- [ ] Documentar o app 2751816731904059, a configuração unificada, as permissões, o token de longa duração, a renovação, o callback oficial, inscrição da página, acesso às mensagens, testers, verificação, App Review e liberação. Citar as fontes oficiais junto das etapas e registrar limites de validação do painel. Conferir com a interface da tarefa 1 e commitar.

### Task 3: Ensaios e entrega

**Arquivos.** `tests/instagram-atendimento-banco.test.ts` e `RESULTADO-DIRECT-LOGIN-FACEBOOK.md`.

- [ ] Testar duas requisições assinadas do mesmo `mid` com o provedor Facebook e PostgreSQL; conferir uma entrada e uma resposta simulada ou um único processamento, além de eco ignorado. Executar a suíte condicional do Direct.
- [ ] Executar checks do repo, fluxos locais e o Vercel agent-browser. No navegador, abrir Conversas com sessão fictícia, conferir a entrada e responder em simulação. Registrar os resultados medidos e as etapas que dependem da Meta. Conferir o diff e commitar.
