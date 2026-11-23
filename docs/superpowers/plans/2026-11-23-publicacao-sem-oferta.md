# Plano de implementação da publicação sem a oferta

> **Para execução:** usar superpowers:subagent-driven-development. A revisão de migrações, a auditoria de canais e a preparação dos testes podem avançar em paralelo com a implementação.

**Objetivo:** Entregar a branch local com a oferta desativada por padrão e todos os fluxos da publicação verificados.

**Arquitetura:** Uma decisão de configuração compartilhada governa os limites da oferta. O proxy rejeita URLs exclusivas antes da autenticação. Páginas, APIs e serviços preservam as verificações no ponto de uso.

**Stack:** Next.js App Router, TypeScript, Prisma, PostgreSQL 16, Vitest e Vercel agent-browser.

**Especificação:** `docs/superpowers/specs/2026-11-23-publicacao-sem-oferta-design.md`.

## Restrições globais

Branch nova a partir de `962f8d7`. PostgreSQL e serviços simulados locais com dados sintéticos. Nenhuma operação remota de escrita, deploy ou envio externo. A configuração dos canais e a autorização de IA paga seguem o código herdado.

## Focos de revisão

- Flag ausente, falsa ou inválida mesmo com configuração de homologação completa.
- Flag verdadeira em produção e tentativa de acesso direto sem sessão.
- Contrato simulado preexistente, links da oferta e cancelamento normal.
- Separação entre adesão suspensa pelo modo e desativação completa pela flag.
- Migração a partir da base de produção, com preservação de linhas existentes.

### Task 1 — Bloqueio integral da oferta

- [x] Exercitar em Vitest a matriz de `ofertaDezembroEmHomologacao(env?)` e `lerConfigOfertaDezembro(env?)`, o 404 das URLs exclusivas antes da autenticação e o curto-circuito de uma operação com a flag desligada. Rodar os testes antes da implementação e confirmar que detectam a lacuna.
- [x] Em `src/lib/oferta-dezembro/config.ts`, exigir `OFERTA_DEZEMBRO_ATIVA === "true"` e `AMBIENTE === "homologacao"` no predicado compartilhado. Atualizar `.env.example` e os testes existentes que habilitam a oferta.
- [x] No `src/proxy.ts`, fechar `/c/dezembro-gratis`, `/assinaturas/dezembro-gratis` e `/api/cliente/oferta-dezembro` para todos os métodos quando desligada, antes dos redirects. Com a flag ligada, deixar a API seguir direto para seu handler. Preservar auth e separação de domínios para as páginas habilitadas. Usar `notFound()` nas duas páginas e `naoEncontrado()` nos handlers POST/PATCH como defesa local.
- [x] Em `src/app/c/(area)/planos/page.tsx` e `src/components/cliente/PlanosCliente.tsx`, distinguir visibilidade de contratos e disponibilidade de adesão. Fechar o cartão de contrato mesmo com registro antigo. Em `src/app/c/(area)/planos/cancelar/page.tsx`, redirecionar à oferta só quando habilitada. Na resposta de assinatura geral e no bot, manter o isolamento de contratos simulados e evitar divulgar links ou dados da promoção quando desligada. Preservar o comportamento de assinaturas regulares, inclusive rateio, comissões e indicadores.
- [x] Rodar os testes dirigidos e revisar o diff. Commit local de implementação após a própria checagem, seguido de revisão independente.

### Task 2 — Validação e entrega

- [x] Revisar as quatro migrações novas, ensaiar a atualização a partir de `origin/main` e conferir drift do schema em banco descartável.
- [x] Rodar lint, regras locais, tipos, Vitest (incluindo testes de banco em destinos próprios), fluxos e build. Usar simuladores e impedir conexões externas durante os testes que executam gateways.
- [x] No Chromium via Vercel agent-browser, abrir rotas da oferta com e sem sessão, navegar por planos, assinaturas e pontos de entrada associados, verificar 404 das APIs e repetir em homologação com a flag ligada. Cobrir contrato simulado sem conversão em contrato comum.
- [x] Revisar a integração, registrar commits, efeitos, configuração, migrações, resultados e riscos em `RESULTADO-PUBLICACAO-SEM-OFERTA.md`. Commit local e conferência de que a branch original permanece em `962f8d7`.
