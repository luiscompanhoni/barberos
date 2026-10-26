# Setup e evidências

## Origem e contexto

- Verificação: 15/10/2026, com o [Vibe Coding Toolkit](https://github.com/soumatheusgomes/vibe-coding-toolkit), revisão `f13bb35` (15/10/2026), prompt `12-existing-project-setup`.
- Projeto existente: Next.js 16.3.7, React 19.2, Prisma 6.19.3 + PostgreSQL 16, Tailwind 4, Vitest 5. Node 24, npm 11, Windows 11 (Git Bash e PowerShell) no desenvolvimento.
- Cliente: Claude Code (app desktop). Modelo principal e autenticação da sessão foram preservados.
- Política de subagentes: nenhuma política de seleção foi autorizada, então subagentes usam o modelo da sessão. Nenhum custo foi estimado ou medido.
- Brainstorming: a skill do Superpowers ainda não existia no início. O protocolo foi conduzido manualmente (resumo, pergunta única de autorização, matriz, plano) e as instalações fora do projeto foram autorizadas pelo usuário.

## Decisões e fontes

- **Prisma mantido** (exceção ao default Drizzle do toolkit, que diz para não migrar projeto existente). Está em `PRODUCT.md` e `docs/architecture.md`. Revisitar só se houver um motivo concreto de produto.
- **Perfil leve das regras de lint** (`templates/eslint/eslint-rules/next-base.mjs`), adaptado:
  - `max-lines` com baseline dos arquivos que já passavam do limite;
  - `no-direct-data-access` só em `src/components`, com a binding `db`;
  - `no-direct-console` adiada até existir um logger.
- **Skills da Vercel:** só as web, mais `find-skills`. As de deploy e métricas da Vercel ficaram de fora porque a produção é um VPS. Instaladas com `--copy` (Windows) e só para o `claude-code`; o Codex não é usado.
- **Navegador:** `agent-browser` e Chrome DevTools MCP não foram instalados. O navegador embutido do app (console, rede, screenshots, viewport) e o Claude in Chrome já cobrem automação e depuração, com uso comprovado neste projeto.
- **Memória em camadas:** a memória automática do Claude Code mais os docs do projeto. O Ruflo já fornece memória vetorial; não há Obsidian.
- **Skills da Anthropic (documentos Office) e aia-harness:** não aplicáveis. Não há necessidade de gerar documentos, e o Ruflo já faz o papel de harness.
- **Atualização do Next 16.4.1** (corrige advisories): não aplicada. Mexe em produção e depende de decisão. Ver `docs/quality.md`.

## Componentes

| Componente | Ação e motivo | Escopo | Estado e evidência |
|---|---|---|---|
| Superpowers 6.4.1 | instalado do marketplace `claude-plugins-official` (atualizado antes) | usuário | `claude plugin install` ok; descoberta só a partir de uma nova sessão |
| Context7 | plugin do marketplace oficial | usuário | instalado; consulta real pendente na próxima sessão |
| Ponytail 5.2.0 | marketplace `DietrichGebert/ponytail`; hooks revisados (Node local, sem rede) | usuário | instalado; ativa na próxima sessão |
| Caveman 4.0.1 | marketplace `JuliusBrussee/caveman`; hooks revisados (Node local, sem rede) | usuário | instalado; ativa na próxima sessão |
| RTK 1.0.1 | binário de release oficial `rtk-ai/rtk` (sha256 conferido com `checksums.txt`) em `~/.local/bin`, mais `rtk init --global` (hook PreToolUse no Bash, `RTK.md`, `@RTK.md` no CLAUDE.md global; backup em `settings.json.bak`) | usuário | `rtk hook claude` reescreve `git status` para `rtk git status`. Não conflita com o hook do Ruflo, que só valida. Limitação no Windows descrita abaixo |
| Graphify 0.9.91 | `uv tool install graphifyy`, `.graphifyignore` adaptado, `graphify-out/` no `.gitignore`, sem hook Git | usuário + projeto | `graphify extract . --code-only --no-cluster`: 512 arquivos, 3062 nós, 11479 arestas; `graphify explain "importarStone"` devolve chamadas e importadores reais |
| Skills Vercel | `vercel-react-best-practices`, `vercel-composition-patterns`, `web-design-guidelines`, `writing-guidelines`, `vercel-react-view-transitions` e `find-skills` em `.claude/skills/` + `skills-lock.json` | projeto | 6 pastas, só Markdown (sem scripts); `web-design-guidelines` busca as regras na web ao ser usada |
| Regras de qualidade | `eslint-rules/` (cópia do toolkit), `eslint.config.mjs`, `scripts/verify-quality-rules.mjs`, scripts `lint:rules`, `typecheck`, `check`; etapa no CI | projeto | self-check ok; lint 0 problemas; um arquivo de teste com import de `db` e 360 linhas disparou as duas regras e foi apagado |
| Ruflo | já instalado (plugins, hooks, memória) | usuário | mantido. Ver limitação abaixo |
| Navegador do app / Claude in Chrome | reaproveitados | cliente | `.claude/launch.json` (`barberos`, porta 3000) |

### Limitação: RTK e curingas no Windows

Com o hook ativo, um comando como `find . -name "*.md"` vira `rtk find ...`. O `rtk.exe` repassa `*.md` sem aspas para o binário do Git Bash, e o runtime MSYS expande o curinga, então o comando falha.

A variável `MSYS=noglob` evita isso, mas quebra comandos `bash -c '...'` (aspas simples), inclusive hooks do Ruflo. Por isso foi testada e **revertida** do `settings.json`.

**Recomendação:** use as ferramentas Glob/Grep do cliente para busca por padrão, ou `rtk proxy` sem curingas. Se for crítico, `rtk init --global --uninstall` remove a integração.

## Documentação criada

- `PRODUCT.md`, `docs/architecture.md` (inclui "Operação"), `docs/design.md`, `docs/onboarding.md`, `docs/quality.md` e este arquivo: novos, com conteúdo do projeto.
- `README.md`: reduzido de 621 para 58 linhas, como porta de entrada. Cada seção antiga foi movida para PRODUCT/architecture/onboarding, sem perda.
  - Foram corrigidos detalhes desatualizados: `teste:roleta` virou `teste:jogos`, `src/lib/roleta` virou `src/lib/jogos`, e Node 20 virou Node 24.
  - Domínios, IPs e telefones foram retirados.
- `AGENTS.md`: o bloco do Next foi preservado intacto, com produto, comandos reais, acordos, ferramentas, skills, delegação e convenções.
- `CLAUDE.md`: `@AGENTS.md`, sem mudança.
- `docs/pendencias.md`: mantido.

## Verificações

| Item | Antes | Depois | Evidência |
|---|---|---|---|
| Tipos (`tsc --noEmit`) | 0 erros | 0 erros | `npm run check` |
| Lint | 0 problemas | 0 problemas (com `quality/*`) | `npm run check` |
| Regras locais | — | 3 regras ok | `npm run lint:rules` |
| Testes unitários | 30 arquivos, 252 testes | 30 arquivos, 252 testes | `npm run check` |
| Build | ok | ok | `npm run check` (exit 0) |
| Testes de fluxo | não rodados neste setup | não rodados | nada no domínio mudou; o CI roda `teste:todos` |
| `npm audit --omit=dev` | — | 5 altos, 0 críticos | ver `docs/quality.md` |
| Plugins de usuário | — | instalados, descoberta pendente | requer nova sessão |
| Context7 | — | configurado sem execução | consultar uma API na próxima sessão |

Nenhum recurso temporário ficou ativo (o arquivo de teste das regras foi removido). Nenhuma alteração em produção, publicação ou push.

## Pendências e próxima entrega

1. **Reiniciar o Claude Code** para carregar Superpowers, Context7, Ponytail, Caveman e o hook do RTK. Depois:
   - fazer uma consulta ao Context7 (ex.: "Next.js 16 route handlers");
   - rodar `rtk gain` para ver a economia medida.
2. **Decidir a atualização do Next para 16.4.1** (advisories altos). Depois: `check`, `teste:todos` e deploy.
3. Dividir os 3 arquivos da baseline de `max-lines` quando forem mexidos.
4. Avaliar um logger estruturado para então ativar `no-direct-console`.
5. Regenerar o grafo depois de mudanças grandes: `graphify extract . --code-only --no-cluster`.

Code review sugerido para este setup: **3 ciclos**. O risco é baixo, porque só mudaram configuração e docs, sem código de produto.

1. Regras de lint, CI e scripts.
2. Precisão dos docs contra o código.
3. Integração: `check` mais os comandos documentados no onboarding.

Prompt:

```text
Faça 3 ciclos de code review do setup do toolkit no BarberOS (diff não commitado):
1) eslint.config.mjs, eslint-rules/, scripts/verify-quality-rules.mjs, package.json e .github/workflows/ci.yml: as regras estão corretas, sem afrouxar nada?
2) PRODUCT.md, README.md, AGENTS.md e docs/*.md contra o código: há afirmação falsa, comando inexistente ou dado sensível?
3) Integração: rode npm run check e confira cada comando citado em docs/onboarding.md.
Registre os achados com severidade, arquivo:linha e evidência; corrija só o que for confirmado.
```
