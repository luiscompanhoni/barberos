# Preparação local

## Pré-requisitos

- **Node 24** e **npm 11** (versões da máquina de desenvolvimento; o Dockerfile usa `node:24-alpine` e o CI
  `node-version: 24`). O `package.json` não declara `engines` e não há `.nvmrc`.
- **Docker** (Postgres 16 local pelo `docker-compose.yml` da raiz).
- **Git Bash** no Windows para `npm run teste:todos` (script bash) e `scripts/deploy.sh`.

## Primeira execução

```bash
npm ci                         # instala pelo package-lock.json
cp .env.example .env           # troque SESSION_SECRET; ANTHROPIC_API_KEY é opcional (sem ela o bot passa para a equipe)
docker compose up -d           # Postgres na porta 5433
npm run db:migrate             # prisma migrate dev: cria as tabelas
npm run db:seed                # dados de exemplo (barbearia, equipe, serviços)
npm run dev                    # site: http://localhost:3000 · painel: http://painel.localhost:3000
```

O `.env.example` já vem pronto para teste local, sem nada sair do computador: `OTP_PROVIDER="console"`,
`WHATSAPP_PROVIDER="simulador"`, `PAGAMENTOS_PROVIDER="simulado"`, `MAQUININHA=""` (simulada fora de produção),
`SITE_URL="http://localhost:3000"` e `PAINEL_URL="http://painel.localhost:3000"` (o navegador entende
`*.localhost` sem configuração). Gere o `SESSION_SECRET` (32+ caracteres) como indicado no comentário do arquivo.
Nunca commite o `.env` (está no `.gitignore`).

Variáveis do `.env.example`: `DATABASE_URL`, `SESSION_SECRET`, `TZ_BARBEARIA`, `OTP_PROVIDER`,
`ANTHROPIC_API_KEY`, `BOT_MODELO`, `WHATSAPP_PROVIDER`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`,
`WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_API_VERSION`, `WHATSAPP_TEMPLATE_CODIGO`,
`WHATSAPP_TEMPLATE_AVISO`, `WHATSAPP_NUMERO_PUBLICO`, `EVOLUTION_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCIA`,
`EVOLUTION_WEBHOOK_URL`, `PAGAMENTOS_PROVIDER`, `ASAAS_API_KEY`, `ASAAS_AMBIENTE`, `ASAAS_WEBHOOK_TOKEN`,
`SITE_URL`, `PAINEL_URL`, `APP_URL`, `PAGARME_SECRET_KEY`, `PAGARME_PUBLIC_KEY`, `PAGARME_WEBHOOK_TOKEN`,
`NOME_FATURA`, `COBRANCA_ENDERECO`, `COBRANCA_CEP`, `COBRANCA_CIDADE`, `COBRANCA_UF`, `CELCASH_AMBIENTE`,
`CELCASH_GALAX_ID`, `CELCASH_GALAX_HASH`, `CELCASH_WEBHOOK_TOKEN`, `CELCASH_WEBHOOK_HASH`, `MAQUININHA`,
`STONE_POS_SERIAL`, `STONE_POS_NOMES`, `EMAIL_BALCAO`, `PUSH_PROVIDER`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
`VAPID_SUBJECT`. Configuração de cada integração: ver
[architecture.md](architecture.md#configurar-integrações).

Push começa desativado. Para preparar as chaves, `npm run push:chaves` cria `.env.push` privado sem alterar o `.env`.
Use `PUSH_PROVIDER=simulado` no desenvolvimento; `AMBIENTE=homologacao` sempre bloqueia transporte real.
Instalação e configuração definitiva: [app-notificacoes.md](app-notificacoes.md).

### Entrar

- Equipe: `http://painel.localhost:3000/entrar`. Cliente: `http://localhost:3000/entrar` (qualquer celular; "Criar
  conta" com senha ou entrar pelo código).
- Os usuários do seed (dono, recepção e três barbeiros; telefones em `prisma/seed.ts`) não têm senha: use
  **"Primeiro acesso ou esqueci a senha"**. Com `OTP_PROVIDER="console"` o código aparece na própria tela de login
  (botão "Usar"); depois de entrar, crie a senha. O dono também gera senha temporária em Configurações (`/equipe`).
- Simulador do WhatsApp: `/simulador` (dono, com `WHATSAPP_PROVIDER="simulador"`), conversa como cliente pelo mesmo
  caminho do webhook.

## Banco

- Local: o `docker-compose.yml` da raiz sobe `postgres:16-alpine` (container `barberos-db`, porta `5433`, volume
  `barberos-pg`); o `DATABASE_URL` do `.env.example` aponta para ele. Não há `DATABASE_URL_UNPOOLED`.
- Mudou o schema: edite `prisma/schema.prisma`, rode `npm run db:migrate` (gera e aplica a migração em
  `prisma/migrations/`), revise o SQL gerado e commite schema + migração juntos. O CI falha se o schema não bater
  com as migrações.
- Produção aplica migrações sozinha ao subir (`prisma migrate deploy` no Dockerfile). Não use produção para testes:
  use a homologação ([architecture.md](architecture.md#homologação)).
- Dados de exemplo extras:
  - `npm run db:planos` — planos de exemplo.
  - `npm run db:produtos` — produtos de exemplo.
  - `npm run db:demo` — histórico de demonstração (`prisma/demo-historico.ts`).
  - `npm run criar-dono` — cria o dono (`prisma/criar-dono.ts`).

## Verificar

| Comando | O que faz | Precisa de banco |
|---|---|---|
| `npm run check` | `lint` + `lint:rules` + `typecheck` + `test` + `build` em sequência | não |
| `npm run lint` | ESLint | não |
| `npm run lint:rules` | self-check das regras locais (`scripts/verify-quality-rules.mjs`) | não |
| `npm run typecheck` | `tsc --noEmit` (no CI, depois de `npx prisma generate` e `npx next typegen`) | não |
| `npm test` | testes unitários Vitest (`tests/**/*.test.ts`) | não |
| `npm run teste:<área>` | fluxo completo contra o banco do `.env`, com gateways falsos (sem chamadas reais) | sim |
| `npm run teste:todos` | roda todos os `teste:*` e falha se algum quebrar (`scripts/testes-integracao.sh`) | sim |
| `npm run build` | build de produção | não |

Áreas de `teste:<área>`: `assinaturas`, `pagarme`, `checkout`, `antecipado`, `cancelamento`, `comandas`,
`automacoes`, `crescimento`, `login`, `jogos`, `financeiro`, `despesas`, `estorno`, `rh`, `permissoes`,
`campanhas`, `backups` e `evolucao`. A última cria bancos locais separados para oito módulos, incluindo geração
e envio simulado de notificações; exige permissão local de criar bancos e nunca usa o banco da barbearia.

O CI (`.github/workflows/ci.yml`) roda em cada push na `main` e em cada PR: `npm ci`, tipos, lint, regras locais
(`lint:rules`), testes unitários, migrações num banco limpo + checagem de schema, `db:seed`, `teste:todos` e build. Detalhes de qualidade
em [quality.md](quality.md).

## Agentes

Leia [AGENTS.md](../AGENTS.md). [CLAUDE.md](../CLAUDE.md) importa as mesmas instruções. Consulte
[setup.md](setup.md) para skills locais, integrações e escopos configurados.

## Próximas leituras

[PRODUCT.md](../PRODUCT.md) (escopo e regras), [architecture.md](architecture.md) (código, decisões e operação),
[design.md](design.md) (UI) e [pendencias.md](pendencias.md) (o que falta).

## Dificuldades conhecidas

- Código de login não aparece: confira `OTP_PROVIDER="console"`; em produção (`NODE_ENV=production`) ele só vai
  para o log do servidor.
- Login parece não funcionar em http: o cookie só é `Secure` quando `SITE_URL` e `PAINEL_URL` são https
  (`src/lib/dominios.ts`); mantenha os dois em http no local.
- Pagamento simulado: a fatura vira uma tela de teste com o botão "Pagar"; no detalhe da assinatura há botões para
  simular pagamento, atraso e próximo mês. Em produção, pagamento simulado só é confirmado pela equipe.
