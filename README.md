# BarberOS

Sistema da barbearia Black Barber: agenda por barbeiro, bot do WhatsApp, área do cliente, assinaturas, comanda e
estoque, financeiro com conciliação, campanhas, jogos de recompensa, RH e indicadores. Substitui o CashBarber.
Escopo, papéis e regras em [PRODUCT.md](PRODUCT.md).

Stack: Next.js 16 (App Router) + React 19 + TypeScript, Prisma 6 + PostgreSQL 16, Tailwind 4, Vitest. Roda como
servidor Node sempre ligado (não serverless).

## Executar

Requisitos: Node 24, npm 11 e Docker. Passo a passo, variáveis e login local em
[docs/onboarding.md](docs/onboarding.md).

```bash
npm ci
cp .env.example .env          # troque SESSION_SECRET; tudo simulado por padrão
docker compose up -d          # Postgres na porta 5433
npm run db:migrate            # cria as tabelas
npm run db:seed               # dados de exemplo
npm run dev                   # site: http://localhost:3000 · painel: http://painel.localhost:3000
```

## Comandos principais

| Comando | Para quê |
|---|---|
| `npm run dev` / `npm run build` / `npm start` | desenvolvimento, build e servidor de produção |
| `npm run check` | lint + regras locais + tipos + testes unitários + build |
| `npm run lint` / `npm run lint:rules` / `npm run typecheck` | ESLint, self-check das regras locais e tipos |
| `npm test` | testes unitários (Vitest, sem banco) |
| `npm run teste:todos` | todos os testes de fluxo contra o banco do `.env` (gateways falsos) |
| `npm run teste:<área>` | um fluxo: `assinaturas`, `pagarme`, `checkout`, `antecipado`, `cancelamento`, `comandas`, `automacoes`, `crescimento`, `login`, `jogos`, `financeiro`, `despesas`, `estorno`, `rh`, `permissoes`, `campanhas`, `backups` |
| `npm run db:migrate` / `npm run db:seed` | migrações (dev) e dados de exemplo |
| `npm run db:planos` / `db:produtos` / `db:demo` / `criar-dono` | planos, produtos, histórico de demonstração e dono |
| `bash scripts/deploy.sh <usuario>@<ip> [homolog]` | deploy no VPS (faz backup antes) |

O CI (`.github/workflows/ci.yml`) roda tipos, lint, regras locais, testes unitários, migrações num banco limpo, testes de fluxo e
build em cada push na `main` e em cada PR.

## Documentação

- [Produto e escopo](PRODUCT.md): papéis, permissões, telas, módulos e regras garantidas.
- [Preparação local](docs/onboarding.md): instalar, banco, `.env`, entrar e verificar.
- [Estrutura, decisões e operação](docs/architecture.md): mapa do código, fluxo, integrações, deploy, backups,
  restauração, homologação, domínio e importação do CashBarber.
- [Design e acessibilidade](docs/design.md): paleta Black, utilitários, layout e movimento reduzido.
- [Checks de qualidade](docs/quality.md).
- [Instruções para agentes](AGENTS.md).
- [Setup e evidências](docs/setup.md).
- [Pendências](docs/pendencias.md): o que falta, por fase.

## Próxima entrega

Fase A de [docs/pendencias.md](docs/pendencias.md): migração do CashBarber validada em produção, conciliação completa
(CashBarber + Celcash + Stone), testes de cartão na Pagar.me e decisão entre WhatsApp oficial e Evolution. Também
pendentes: LGPD (termos, consentimento, exclusão/exportação) e a cópia de backup fora do servidor (bucket e
`BACKUP_S3_*`/`BACKUP_SENHA` ainda a preencher).
