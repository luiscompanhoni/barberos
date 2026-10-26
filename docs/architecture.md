# Código e arquitetura

## Stack efetiva

- Next.js 16.3.7 (App Router, saída `standalone`), React 19.2.8, TypeScript 5.
- Prisma 6.19 (`@prisma/client` + CLI) com PostgreSQL 16 (`postgres:16-alpine`). **Exceção ao padrão Drizzle do
  toolkit:** o projeto nasceu em Prisma e continua em Prisma (ver [PRODUCT.md](../PRODUCT.md#exceções-de-stack)).
- Tailwind CSS 4 (`@tailwindcss/postcss`), lucide-react, Zod 4, jose (JWT da sessão), date-fns + `@date-fns/tz`,
  `@anthropic-ai/sdk` (bot).
- Testes: Vitest 5 (`tests/**/*.test.ts`) e scripts de fluxo com `tsx`.
- Runtime: Node 24 (Dockerfile `node:24-alpine` e CI `node-version: 24`); npm com `package-lock.json`.
- Precisa de **um servidor Node sempre ligado + Postgres**: o tempo real (SSE em memória) e as rotinas rodam no
  processo. Não usar hospedagem serverless.

## Mapa do código

```
src/app/(app)/       painel da equipe (agenda, recepcao, comandas, financeiro, jogos, rh, campanhas, auditoria...)
src/app/c/           área do cliente: (area)/ com login; assinar, pagar, link, r, pagamento-simulado públicos
src/app/assine/      página de venda dos planos (a "/" do site)
src/app/entrar/      login da equipe; i/ (indicação), t/ (checklist sem login)
src/app/api/         route handlers das telas, do cliente (/api/cliente), webhooks e /api/saude
src/proxy.ts         separa site × painel e faz a checagem otimista de login
src/instrumentation.ts  log de erros com código; agenda as rotinas; confere o .env e cria o dono em produção
src/lib/db.ts        cliente Prisma único (`db`)
src/lib/erros.ts     ErroNegocio e o wrapper `rota()` dos route handlers
src/lib/auditoria*.ts  registro e consulta da auditoria (antes → depois)
src/lib/eventos.ts   barramento em memória para SSE (agenda, conversa, comanda)
src/lib/limite.ts    limite de requisições em memória (429)
src/lib/dominios.ts, ambiente.ts  site/painel e trava da homologação
src/lib/<domínio>/   regras e serviços por área (ver abaixo)
src/components/<domínio>/  telas client-side por área; componentes comuns na raiz (Modal, Navegacao, AbasPainel...)
prisma/              schema.prisma, migrations/, seed.ts e scripts de dados de exemplo
scripts/             testes de fluxo (teste-*.ts), importadores, relatorio-migracao.ts, deploy.sh
deploy/              compose de produção e homologação, Caddyfile, backup, anonimizar.sql, .env de exemplo
tests/               testes unitários (Vitest, sem banco)
```

Domínios em `src/lib/`: `agenda` (disponibilidade, expediente, horário pago antes), `bot` (prompt, ferramentas,
loop com o Claude), `whatsapp` (canal: Cloud API, Evolution ou simulador; webhook; status; avisos), `auth` (senha,
OTP, sessão, permissões), `assinaturas` (planos, cobranças, retenção, rotina), `pagamentos` (Pagar.me, Celcash,
Asaas, simulado, checkout), `comandas` (estoque, comanda, serviço adicional, maquininha), `financeiro` (caixa,
despesas, extrato, conciliação, resumo), `conciliacao` (extratos Celcash e Stone, regras, resultado do mês),
`estornos`, `crescimento` (espera, indicação, saldo, cashback), `campanhas`, `clientes` (segmentos), `jogos` (motor
de recompensas), `links` (links de pagamento), `checklist`, `rh`, `indicadores`, `automacoes` (mensagens e `.ics`).
Arquivos `regras.ts` guardam lógica pura (testada em `tests/`); `servico.ts`/demais fazem I/O.

## Fronteiras e fluxo

```
página (server component) ──┐
tela client (src/components) ─ fetch → src/app/api/**/route.ts (rota(), Zod) ─┤→ src/lib/<domínio> → db (@/lib/db)
webhooks / rotinas ─────────┘
```

- **Validação:** Zod nos schemas de cada domínio; `ZodError` vira 400 em `rota()`.
- **Erros:** regras de negócio lançam `ErroNegocio(mensagem, status, codigo)` (`naoAutorizado` 401, `proibido`
  403, `naoEncontrado` 404, padrão 422). `rota()` traduz para `{ erro, codigo, detalhes }`; o resto vira 500
  "Erro interno". Erros não tratados em páginas mostram "Algo deu errado" com um código (`error.tsx` e
  `global-error.tsx`); `onRequestError` em `instrumentation.ts` grava `[erro] codigo=<digest> MÉTODO caminho`
  (sem query string, que pode ter token).
- **Sessão:** JWT HS256 (jose) no cookie `barberos_sessao`, httpOnly, `sameSite=lax`, 30 dias, `secure` quando
  site e painel são https. `SESSION_SECRET` com 32+ caracteres. `src/proxy.ts` só faz a checagem otimista; a
  autorização real é em cada rota (`exigirSessao`/`exigirCliente`), e `sessaoAtual()` revalida o usuário no banco
  (desativado perde acesso na hora). Senhas com scrypt; código de login (OTP) por WhatsApp ou console.
- **Permissões:** papéis + matriz `PermissaoPapel` (`src/lib/auth/permissoes*.ts`, função `pode()`).
- **Auditoria:** `auditar(tx, ...)`/`auditarMudanca(...)` gravam na mesma transação da mudança, com IP
  (`x-forwarded-for` posto pelo Caddy) e aparelho; `auditarMudanca` guarda só os campos que mudaram. Migração
  `auditoria_imutavel` impede alterar, apagar ou truncar a tabela.
- **Tempo real:** `publicar()`/`assinar()` em `src/lib/eventos.ts` alimentam SSE. Vale para uma instância; com mais,
  trocar por Postgres LISTEN/NOTIFY ou Redis mantendo a interface.
- **Rotinas** (agendadas em `register()` de `instrumentation.ts`, também em desenvolvimento):
  - `assinaturas/rotina.ts` — de hora em hora: Pix do mês 3 dias antes do vencimento, cobranças vencidas, status
    das assinaturas Celcash, horários pagos antes e links pendentes, fim de cancelamentos e de pausas.
  - `automacoes/rotina.ts` — a cada 5 min: lembretes, pós-falta, pós-atendimento, reativação, aniversário, lista de
    espera, retorno, indicação, campanhas, sincronização recente do extrato Celcash e atualização dos prêmios.
    Cada envio grava antes uma linha única (tipo + chave): nada sai duas vezes.
- **Produção (startup):** exige `DATABASE_URL` e `SESSION_SECRET`; avisa se `SITE_URL`/`PAINEL_URL` sem https,
  `MAQUININHA=simulada`, sem `ANTHROPIC_API_KEY` ou `OTP_PROVIDER=console`; `MAQUININHA=stone` exige
  `STONE_POS_SERIAL`, `PAGARME_SECRET_KEY` e `PAGARME_WEBHOOK_TOKEN`. Com `DONO_TELEFONE` e nenhum dono, cria o dono.

## Dados e migrations

- Schema em `prisma/schema.prisma`; migrações SQL em `prisma/migrations/<timestamp>_<nome>/` (incluem SQL manual,
  como a restrição `EXCLUDE` de agendamentos e o bloqueio da auditoria).
- Desenvolvimento: `npm run db:migrate` (`prisma migrate dev`). Produção: a imagem roda `prisma migrate deploy`
  ao subir. O CI aplica num banco limpo e falha se o schema mudou sem migração (`prisma migrate diff --exit-code`).
- Transações com `db.$transaction` e travas onde há concorrência: `SELECT ... FOR UPDATE` (comanda) e
  `pg_advisory_xact_lock` (jogada por cliente e sorteio por jogo).

## Integrações

- **WhatsApp** (`WHATSAPP_PROVIDER`): `simulador` (nada sai), `cloud` (oficial da Meta; webhook assinado) ou
  `evolution` (não oficial, QR code; serviço `evolution` do compose, sem porta aberta, dados no mesmo Postgres em
  schema próprio). Envio separado em `src/lib/whatsapp/canal.ts`. Status entregue/lida gravado pelos dois.
- **Claude** (bot): `ANTHROPIC_API_KEY`, `BOT_MODELO`.
- **Pagar.me (grupo Stone)**: meio escolhido. A API "Stone Online" só aceita cartão, não tem página de pagamento
  nem webhooks e exigiria PCI DSS. Cartão: tokenizado no navegador, cobrança mensal pela Pagar.me, recusado → link
  para trocar o cartão. Boleto: assinatura na Pagar.me, boleto em `/c/pagar/<código>`. Pix: a Pagar.me não faz Pix
  recorrente; o BarberOS gera o Pix 3 dias antes e manda no WhatsApp (QR + copia e cola, atualiza sozinho).
- **Stone Connect 2.0** (maquininha S920 ou Q92, via API da Pagar.me): `MAQUININHA` = `manual` (padrão em produção:
  digita na maquininha e registra a forma), `simulada` (padrão no computador: botão simula a aprovação) ou `stone`
  (pedido vai direto para a maquininha; o webhook confirma com NSU e bandeira; botão "Conferir" consulta na hora;
  estorno pela API ou na maquininha/portal da Stone).
- **Celcash** (cel_payments, antiga Galax Pay): assinaturas e cobranças criadas por ela (Pix/boleto gerados pela
  Celcash, cartão no link dela). A rotina consulta o status pela API porque a conta só tem uma URL de webhook.
  Extrato do saldo para a conciliação via API v2 com token só de leitura (`src/lib/conciliacao/celcash.ts`).
- **Stone (extrato bancário)**: sem API aberta; o dono sobe o CSV do extrato (`src/lib/conciliacao/stone.ts`).
- **Asaas**: alternativa de cobrança (`PAGAMENTOS_PROVIDER="asaas"`).

## Decisões

- **Valores em centavos inteiros** (`Int`, campos `*Centavos`); formatação em reais só na borda.
- **Idempotência:** jogada com `chave` única enviada pela tela (repetir devolve a mesma jogada); automações com linha
  única por tipo + chave; movimentos externos únicos por `(fonte, idExterno)`; importadores rodam de novo sem
  duplicar; maquininha só marca pago se ainda aguardava (webhook repetido).
- **Prêmio decidido no servidor:** o motor (`src/lib/jogos/motor.ts`) trava o cliente, gasta a ficha, sorteia com
  `node:crypto` respeitando estoque e limite do mês e grava jogada + prêmios antes de responder; a tela só anima.
  Chances em centésimos de % (`chanceBps`, 10 000 = 100%).
- **Ids do CSV da Stone por hash:** a Stone não manda id; `idStone` é SHA-1 de data, horário, valor, saldos e tipo
  (24 hex). A tarifa da linha vira uma TAXA à parte.
- **Regras de conciliação por nome** (`RegraConciliacao.padrao`, sem acento, caixa alta) valem para Celcash e Stone;
  classificação manual não é sobrescrita pela sincronização.
- **Estoque e saldo por movimento**, nunca alterados direto.
- **Auditoria imutável no banco**, não só na aplicação.

## Operação

### Deploy (VPS com Docker Compose)

`deploy/docker-compose.yml` sobe `app` (Dockerfile; aplica migrações e expõe `/api/saude` no healthcheck), `db`
(Postgres sem porta publicada), `caddy` (https automático via Let's Encrypt, portas 80/443), `backup` e, com
`COMPOSE_PROFILES="evolution"`, `evolution`. Na pasta do projeto (Git Bash):

```bash
bash scripts/deploy.sh <usuario>@<ip-do-vps>            # produção
bash scripts/deploy.sh <usuario>@<ip-do-vps> homolog    # homologação
```

- Empacota os arquivos do git (sem `.env` local, `node_modules`, `.next`), envia por scp e sobe por ssh.
- **Produção: faz backup do banco antes de trocar qualquer coisa** (`...-antes-do-deploy.sql.gz`); se falhar, para.
- 1ª vez: instala o Docker e cria `/opt/barberos/.env` de `deploy/env.producao.exemplo` com `DB_SENHA` e
  `SESSION_SECRET` aleatórios; gera `EVOLUTION_API_KEY`. Preencha `DONO_TELEFONE`, `ANTHROPIC_API_KEY` etc. e rode de
  novo. Depois só troca o código: `.env`, backups e `caddy-sites/` ficam.
- Erro "Algo deu errado" com código: `cd /opt/barberos && docker compose logs app | grep "codigo=<código>"`.
- Enquanto `OTP_PROVIDER="console"`, o código de login aparece só em `docker compose logs app`.

Variáveis de produção (lista comentada em `deploy/env.producao.exemplo`): `SITE_URL`, `PAINEL_URL`, `APP_URL`,
`CADDY_ENDERECOS` (`:80` para testar só pelo IP), `CADDY_PAINEL_ANTIGO`, `CADDY_IP`, `DONO_TELEFONE`, `DONO_NOME`,
`NOME_BARBEARIA` (criam o dono no 1º deploy), `ANTHROPIC_API_KEY`, `WHATSAPP_*`, `OTP_PROVIDER`, `COMPOSE_PROFILES`,
`PAGAMENTOS_PROVIDER`, `PAGARME_*`, `COBRANCA_*`, `NOME_FATURA`, `CELCASH_*`, `MAQUININHA`, `STONE_POS_*`,
`EMAIL_BALCAO`, `BACKUP_*`, `BACKUP_S3_*`, `TZ_BARBEARIA`, `WHATSAPP_NUMERO_PUBLICO`, `BOT_NOME_ATENDENTE`.

**Railway (alternativa):** New Project → Deploy from GitHub repo (detecta o Dockerfile) → Add PostgreSQL →
variáveis (`DATABASE_URL` e `SESSION_SECRET` com 64 caracteres aleatórios) → Settings → Networking → Generate Domain.
Lá não há Evolution nem o backup do compose.

### Site, painel e domínio

- O mesmo serviço atende `SITE_URL` e `PAINEL_URL`; sem `PAINEL_URL`, tudo num endereço só. No computador:
  `http://localhost:3000` e `http://painel.localhost:3000`.
- DNS: `painel` é CNAME ou A comum; o domínio sem "www" precisa de registro A para o IP do VPS (no Registro.br
  CNAME no topo não funciona). Webhooks podem usar qualquer um dos dois; use o do painel.
- Trocar de domínio: ajuste `SITE_URL`, `PAINEL_URL` e `CADDY_ENDERECOS` e rode o deploy. `CADDY_PAINEL_ANTIGO`
  redireciona o painel antigo (a `/api/*` continua atendendo nele para webhooks antigos); `CADDY_IP` manda quem
  digita só o IP para o painel. Atualize as URLs de webhook na Meta, Pagar.me e Celcash.

### Backups e restauração

- Container `backup` (`deploy/backup.sh`): todo dia às 03h (`BACKUP_HORA`; e ao subir, se passou da hora) copia o
  banco, **restaura num banco separado** e confere tabelas, última migração e contagens. Falha aparece como erro.
  Cópias ficam 14 dias (`BACKUP_DIAS_LOCAL`) em `/opt/barberos/backups`.
- Painel: Configurações → Backups; atraso de mais de 26 h ou falha aparece em "Precisa de ação" para o dono.
- **Cópia fora do servidor** (recomendada; sem ela, perder o VPS é perder os backups): bucket S3 privado
  (Backblaze B2 ou Cloudflare R2) com chave só dele; preencha `BACKUP_S3_BUCKET`, `BACKUP_S3_ENDPOINT`,
  `BACKUP_S3_CHAVE`, `BACKUP_S3_SEGREDO` e `BACKUP_SENHA` (guarde fora do servidor: sem ela a cópia não abre) e rode
  o deploy. Cada backup sobe criptografado (AES-256) e fica 30 dias (`BACKUP_DIAS_FORA`).
- Comandos no servidor, em `/opt/barberos`, com o prefixo `dc = docker compose --env-file .env -f deploy/docker-compose.yml`:
  - backup agora: `dc exec backup backup.sh agora`
  - testar um arquivo: `dc exec backup backup.sh verificar /backups/barberos-AAAAMMDD-HHMM.sql.gz`
- **Restaurar** (a produção só muda no passo 2):
  1. `dc exec backup backup.sh restaurar /backups/<arquivo>.sql.gz` cria `barberos_restaurado` sem tocar na produção.
  2. `dc stop app evolution backup`; depois
     `dc exec db psql -U barberos -d postgres -c 'ALTER DATABASE barberos RENAME TO barberos_antigo' -c 'ALTER DATABASE barberos_restaurado RENAME TO barberos'`
     e `dc start app evolution backup`. O anterior fica como `barberos_antigo` até ser apagado.
  3. Cópia de fora: baixe o `.enc`, abra com
     `openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in arquivo.sql.gz.enc -out arquivo.sql.gz` (pede a
     `BACKUP_SENHA`), copie para `/opt/barberos/backups` e siga o passo 1.

### Homologação

Mesmo VPS, banco e sistema próprios (`deploy/docker-compose.homolog.yml`, serviço `app-homolog`), atrás do Caddy da
produção pela rede `barberos-proxy`, com usuário/senha (basic auth) e `X-Robots-Tag: noindex`. `AMBIENTE=homologacao`
força WhatsApp, pagamentos e maquininha simulados e mostra a faixa "HOMOLOGAÇÃO"; o código de login aparece na tela.

1. Crie no DNS o registro A do endereço da homologação (`HOMOLOG_DOMINIO`) para o IP do VPS.
2. Rode o deploy da produção uma vez (prepara `caddy-sites/`).
3. `bash scripts/deploy.sh <usuario>@<ip> homolog`: cria `/opt/barberos-homolog/.env`, sobe e mostra a senha
   (usuário `homolog`, guardada em `/opt/barberos-homolog/.senha-homolog`).
4. Banco vazio: preencha `DONO_TELEFONE` e rode de novo, ou copie a produção:
   `bash scripts/homolog-copiar-producao.sh <usuario>@<ip>` troca o banco por uma cópia **anonimizada**
   (`deploy/anonimizar.sql`: clientes viram "Cliente 123" com telefone fictício, sem CPF/e-mail; conversas,
   auditoria e códigos de login somem; sem sessão do WhatsApp). A produção só é lida; a equipe entra com o mesmo
   acesso da produção.

Rotina: atualização nova vai primeiro para a homologação (de preferência com cópia recente da produção) e só
depois para a produção.

### Configurar integrações

- **WhatsApp oficial:** app Business em developers.facebook.com com o produto WhatsApp e número exclusivo;
  `WHATSAPP_PROVIDER="cloud"`, `WHATSAPP_TOKEN` (token permanente de usuário do sistema), `WHATSAPP_PHONE_NUMBER_ID`,
  `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`; webhook `<PAINEL_URL>/api/whatsapp/webhook` com o campo `messages`.
  Templates: Autenticação com botão "copiar código" → `WHATSAPP_TEMPLATE_CODIGO` (depois `OTP_PROVIDER="whatsapp"`);
  Utilidade com corpo `Olá {{1}}! {{2}}` → `WHATSAPP_TEMPLATE_AVISO` (avisos fora da janela de 24 h).
- **Evolution:** sem custo por mensagem nem templates, mas sem garantia da Meta (envio em massa pode bloquear o
  número). `WHATSAPP_PROVIDER="evolution"` e `COMPOSE_PROFILES="evolution"`, deploy, e na tela WhatsApp (dono) leia o
  QR code (Aparelhos conectados). Depois `OTP_PROVIDER="whatsapp"`. Quem conectou antes do status de entrega toca em
  **Conectar** de novo (refaz o webhook, sem QR).
- **Pagar.me:** chaves de teste (`sk_test_`/`pk_test_`) pelo comercial da Stone; `PAGAMENTOS_PROVIDER="pagarme"`,
  `PAGARME_SECRET_KEY`, `PAGARME_PUBLIC_KEY`, `PAGARME_WEBHOOK_TOKEN`, `SITE_URL`, `NOME_FATURA` e `COBRANCA_ENDERECO`,
  `COBRANCA_CEP`, `COBRANCA_CIDADE`, `COBRANCA_UF` (exigidos no cartão). Na dashboard: cadastre o domínio e o webhook
  `<PAINEL_URL>/api/pagamentos/pagarme/webhook?token=<PAGARME_WEBHOOK_TOKEN>` com `charge.*`, `invoice.*`, `order.*` e
  `subscription.canceled`. Teste real no ambiente de teste antes das chaves de produção.
- **Maquininha `stone`:** peça ao comercial a ativação do Connect 2.0 na mesma conta Pagar.me; `MAQUININHA="stone"`,
  `STONE_POS_SERIAL` (etiqueta de trás; várias separadas por vírgula), `STONE_POS_NOMES` (opcional),
  `PAGARME_SECRET_KEY` e `EMAIL_BALCAO` (pedidos de cliente sem cadastro). Webhook é o mesmo da Pagar.me.
- **Celcash:** variáveis `CELCASH_*` em `deploy/env.producao.exemplo`; webhook
  `<PAINEL_URL>/api/pagamentos/celcash/webhook?token=<CELCASH_WEBHOOK_TOKEN>` (`CELCASH_WEBHOOK_HASH` = confirmHash).
- **Asaas:** chave em Integrações → Chave de API; `PAGAMENTOS_PROVIDER="asaas"`, `ASAAS_API_KEY`, `ASAAS_AMBIENTE`
  (`sandbox` ou `producao`), `SITE_URL`; webhook `<PAINEL_URL>/api/pagamentos/webhook` com token em
  `ASAAS_WEBHOOK_TOKEN`, eventos de cobrança.
- **Google Agenda:** botão por barbeiro em Horários; o Google só lê o link com `PAINEL_URL` em https.

### Importação do CashBarber

Scripts em `scripts/`, rodados com `DATABASE_URL=... npx tsx scripts/<script>.ts`. Os CSVs têm dados pessoais: não
copie para dentro do projeto. Todos rodam de novo sem duplicar; os que aceitam `--aplicar` só mostram o que fariam.

1. `importar-cashbarber.ts`: serviços, barbeiros, planos e produtos de `scripts/dados/cashbarber.json`.
2. `importar-clientes-cashbarber.ts <Clientes.csv>`: telefone repetido vira um cadastro; existente só ganha CPF,
   e-mail e nascimento que faltavam.
3. `importar-assinantes-cashbarber.ts <Relatorio19.csv> [--aplicar]`: liga assinantes aos clientes pelo nome; a
   cobrança continua no CashBarber (o BarberOS não cobra nem avisa).
4. `importar-historico-cashbarber.ts <pasta> [--ate=AAAA-MM-DD|agora] [--futuros] [--aplicar]`: agendamentos e
   comandas com pagamentos, sem mensagens; na virada, `--ate=agora --futuros` traz os horários marcados.
5. `importar-mensalidades-cashbarber.ts <pasta> [--ate=...] [--aplicar]`: mensalidades pagas; quem saiu ganha
   assinatura cancelada de histórico.
6. `importar-mensalidades-celcash.ts [--aplicar]`: mensalidades pagas a partir do extrato Celcash já guardado.

Conferência: `relatorio-migracao.ts [--clientes=Clientes.csv] [--assinantes=Relatorio19.csv] [--saida=pasta]` só lê
o banco e mostra clientes e dados completos, histórico e frequência, assinaturas, possíveis duplicados e
incompletos; com os CSVs, quem ficou de fora; com `--saida`, grava CSVs (fora da pasta do projeto).

## Manutenção

Atualize este mapa ao alterar diretórios, dependências relevantes, contratos, rotinas ou o processo de deploy.
