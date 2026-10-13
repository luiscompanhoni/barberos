# BarberOS

Sistema de atendimento da barbearia: agenda por barbeiro, bot do WhatsApp, área do cliente, assinaturas e estoque.

- **Fase 1 (pronta):** agenda, app do barbeiro, tela da recepção e painel do dono.
- **Fase 2 (pronta):** bot do WhatsApp com Claude, conversas da equipe, simulador e área do cliente no site.
- **Fase 3 (pronta, local):** assinaturas com cobrança recorrente (Asaas ou simulado), regras de plano, lista de espera e anti-cancelamento.

## Rodar localmente

Requisitos: Node 20+ e Docker.

```bash
cp .env.example .env          # depois troque SESSION_SECRET e coloque ANTHROPIC_API_KEY
docker compose up -d          # Postgres na porta 5433
npx prisma migrate dev        # cria as tabelas
npm run db:seed               # dados de exemplo
npm run dev                   # site: http://localhost:3000 · painel: http://painel.localhost:3000
```

Login por celular + código. Em teste local (`OTP_PROVIDER="console"`, fora de produção) o código aparece
**na própria tela de login** (botão "Usar"). Com `OTP_PROVIDER="whatsapp"` ele chega por WhatsApp.

| Quem      | Onde entra                              | Celular (seed)  |
|-----------|-----------------------------------------|-----------------|
| Dono      | `painel.localhost:3000/entrar`          | (11) 90000-0001 |
| Recepção  | `painel.localhost:3000/entrar`          | (11) 90000-0002 |
| Joao      | `painel.localhost:3000/entrar`          | (11) 90000-0011 |
| Pedro     | `painel.localhost:3000/entrar`          | (11) 90000-0012 |
| Lucas     | `painel.localhost:3000/entrar`          | (11) 90000-0013 |
| Clientes  | `localhost:3000/entrar`                 | qualquer celular (o cadastro é criado no primeiro acesso) |

## Telas

Equipe:
- **Recepção** (`/recepcao`): uma coluna por barbeiro, horários livres em destaque. Clique no vazio para encaixar;
  arraste para mudar horário ou barbeiro; puxe a borda de baixo para mudar a duração. Atualiza ao vivo.
- **Semana** (`/semana`) e **Minha agenda** (`/minha-agenda`, barbeiro).
- **Horários** (`/expediente`): semana padrão, folga / dia extra / horário diferente, fechar agenda.
- **Conversas** (`/conversas`, dono e recepção): acompanha o bot, assume a conversa e responde pelo painel;
  "Devolver para o bot" volta ao atendimento automático.
- **Simulador** (`/simulador`, dono, só com `WHATSAPP_PROVIDER="simulador"`): conversa como se fosse um cliente
  no WhatsApp, passando pelo mesmo caminho do webhook (bot, agenda, avisos).
- **Comandas** (`/comandas`): uma comanda por cliente. Abra pelo atendimento na agenda (botão "Comanda": o
  serviço entra com o preço certo, zero se for pelo plano) ou avulsa no balcão. Toque nos produtos do bar/loja,
  receba em uma ou mais formas e feche: o estoque baixa no fechamento.
- **Estoque** (`/estoque`, dono e recepção): produtos do bar, da loja e de uso interno; entrada (compra), ajuste de
  contagem, consumo e perda, com histórico de cada movimento; o painel avisa o que está acabando.
- **Equipe e serviços** (`/equipe`, dono).

Cliente (`/c`): próximos horários (remarcar e cancelar), histórico, agendar em 4 passos
(serviço → barbeiro ou "qualquer um" → dia e hora → confirmar) e perfil com preferências de corte.

## Bot do WhatsApp

- Claude com ferramentas (`src/lib/bot/`): listar serviços, consultar horários, agendar, remarcar, cancelar,
  meus agendamentos, salvar nome e chamar atendente. O bot nunca inventa horário: sempre consulta a agenda.
- Modelo padrão `claude-opus-5-5` com effort baixo e fallback de recusa; troque com `BOT_MODELO`.
- Sem `ANTHROPIC_API_KEY`, o bot passa a conversa para a equipe e avisa o cliente.
- Quando a equipe remarca, troca o barbeiro ou cancela um atendimento, o cliente recebe aviso no WhatsApp.

### Ligar o WhatsApp oficial (Cloud API)

1. Em developers.facebook.com, crie um app do tipo Business e adicione o produto WhatsApp; vincule um número
   exclusivo da barbearia.
2. Preencha no `.env`: `WHATSAPP_PROVIDER="cloud"`, `WHATSAPP_TOKEN` (token permanente de usuário do sistema),
   `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET` e um `WHATSAPP_VERIFY_TOKEN` inventado por você.
3. Configure o webhook com a URL pública `https://SEU-DOMINIO/api/whatsapp/webhook`, o mesmo verify token, e
   assine o campo `messages`.
4. Crie e aguarde aprovação de dois templates:
   - Autenticação (código de acesso, com botão "copiar código") → `WHATSAPP_TEMPLATE_CODIGO`; depois mude
     `OTP_PROVIDER="whatsapp"`.
   - Utilidade, corpo `Olá {{1}}! {{2}}` → `WHATSAPP_TEMPLATE_AVISO` (avisos fora da janela de 24h).

## Colocar em produção

A imagem Docker (`Dockerfile`) aplica as migrações sozinha ao subir e expõe `/api/saude` para o healthcheck.
Precisa de **um servidor Node sempre ligado + Postgres** (o tempo real e o bot rodam no processo; não use
hospedagem serverless).

Variáveis de ambiente mínimas:

| Variável | Valor |
|---|---|
| `DATABASE_URL` | Postgres gerenciado (Railway, Neon, Supabase...) |
| `SITE_URL`, `PAINEL_URL` | `https://blackbarber.com.br` e `https://painel.blackbarber.com.br` (ver "Site e painel") |
| `SESSION_SECRET` | 64 caracteres aleatórios (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) |
| `ANTHROPIC_API_KEY` | chave do Claude |
| `DONO_TELEFONE`, `DONO_NOME`, `NOME_BARBEARIA` | criam o dono no primeiro deploy (depois podem sair) |
| `WHATSAPP_*`, `OTP_PROVIDER` | ver "Ligar o WhatsApp oficial". Enquanto `OTP_PROVIDER="console"`, o código de login aparece só no log do servidor |

**Railway (recomendado para começar):** New Project → Deploy from GitHub repo (detecta o Dockerfile) → Add
PostgreSQL → preencha as variáveis → Settings → Networking → Generate Domain (ou seu domínio próprio).

### Site e painel (dois endereços, um sistema)

- `blackbarber.com.br`: a página inicial é a de venda dos planos; `/entrar` é o login do cliente, que agenda, vê
  horários e paga por ali. Links de pagamento enviados no WhatsApp também usam esse endereço.
- `painel.blackbarber.com.br`: o sistema da equipe (agenda, comandas, estoque, conversas, configurações).
- O mesmo serviço atende os dois: no Railway, adicione os **dois** domínios ao serviço (Settings → Networking →
  Custom Domain). Página de equipe aberta no site vai para o painel e vice-versa; os logins são separados.
- DNS: `painel` é um CNAME comum. O domínio sem "www" (`blackbarber.com.br`) precisa de CNAME no topo, que o
  Registro.br não faz: use o DNS gratuito da Cloudflare (aponte os nameservers do Registro.br para ela) ou
  redirecione para `www.blackbarber.com.br`.
- Webhooks (Meta, Pagar.me) podem usar qualquer um dos dois; use o do painel.
- No computador: `SITE_URL=http://localhost:3000` e `PAINEL_URL=http://painel.localhost:3000` (o navegador já
  entende `*.localhost`, sem configurar nada).

**VPS (Hostinger, DigitalOcean...):** `docker build -t barberos .` e `docker run -d -p 3000:3000 --env-file .env
barberos`, com Postgres gerenciado ou em outro container e um proxy com HTTPS (Caddy ou Nginx) na frente.

## Assinaturas (Fase 3)

- **Planos** (`/planos`, dono): preço, serviços incluídos (à vontade ou N por mês), dias entre usos, horários por vez,
  dias da semana, vagas, desconto nos extras, formas de pagamento (um plano só aceita Pix, cartão e boleto) e
  barbeiros que atendem. Mudar o preço vale só para novas adesões.
- **Assinaturas** (`/assinaturas`, dono e recepção): assinantes, receita recorrente, vendas × cancelamentos do mês,
  motivos de cancelamento, venda no balcão (gera o link e manda no WhatsApp), cobrar atrasado, cancelar.
- **Cliente** (`/c/planos`): assina e paga na fatura do meio de pagamento (o sistema nunca vê dados de cartão),
  entra na lista de espera se lotar, cancela informando o motivo.
- **Bot**: apresenta os planos, assina (pede o CPF e manda o link), explica as regras do plano, oferece avulso com o
  desconto de assinante, manda o link de mensalidade atrasada e tenta reter antes de cancelar.
- **Na agenda**: o serviço coberto sai por R$ 0 (selo "Assinante"); quando a regra não cobre, o sistema explica e
  oferece marcar como avulso. Ao ativar o plano, horários já marcados passam a sair pelo plano.
- **Pagamentos**: ativa ao pagar, fica "atrasada" (ainda vale por `toleranciaAtrasoDias`, padrão 3) e depois
  suspende; o cliente recebe os avisos no WhatsApp. O webhook confere o token e busca o status real no Asaas.
- **Testar sem Asaas**: `PAGAMENTOS_PROVIDER="simulado"`. A fatura vira uma tela de teste com o botão "Pagar"; no
  detalhe da assinatura há botões para simular pagamento, atraso e o próximo mês. `npm run teste:assinaturas`
  roda o ciclo completo (17 verificações) no banco de desenvolvimento.

### Ligar a Pagar.me (Stone) - meio de pagamento escolhido

A API "Stone Online" só aceita cartão, não tem página de pagamento nem webhooks e exigiria que o sistema recebesse
o número do cartão (certificação PCI DSS). Por isso a cobrança é feita pela **Pagar.me**, do grupo Stone:

| Forma | Como funciona |
|---|---|
| Cartão | O cliente digita na página `/c/assinar/<código>`; o número vai do navegador direto para a Pagar.me e vira token. A Pagar.me cobra todo mês. Cartão recusado: o cliente recebe o link para trocar o cartão. |
| Boleto | Assinatura na Pagar.me; o boleto de cada mês aparece em `/c/pagar/<código>`. |
| Pix | A Pagar.me não faz Pix recorrente: o BarberOS gera o Pix do mês 3 dias antes do vencimento e manda no WhatsApp. A página mostra QR + copia e cola e atualiza sozinha quando o pagamento cai. |

1. Peça a conta Pagar.me ao seu comercial da Stone e pegue as chaves de teste (`sk_test_`/`pk_test_`).
2. `.env`: `PAGAMENTOS_PROVIDER="pagarme"`, `PAGARME_SECRET_KEY`, `PAGARME_PUBLIC_KEY`, `PAGARME_WEBHOOK_TOKEN`, `SITE_URL`.
3. Na dashboard da Pagar.me: cadastre o domínio do sistema (exigido para o cartão) e o webhook
   `https://SEU-DOMINIO/api/pagamentos/pagarme/webhook?token=<PAGARME_WEBHOOK_TOKEN>` com os eventos
   `charge.*`, `invoice.*`, `order.*` e `subscription.canceled`.
4. `npm run teste:pagarme` roda o fluxo completo contra uma Pagar.me falsa (sem chamadas reais).
5. Faça um teste real no ambiente de teste da Pagar.me antes de trocar para as chaves de produção.

### Ligar o Asaas (alternativa)

1. Crie a conta (use o sandbox para testar) e gere a chave em Integrações → Chave de API.
2. `.env`: `PAGAMENTOS_PROVIDER="asaas"`, `ASAAS_API_KEY`, `ASAAS_AMBIENTE="sandbox"` (ou `producao`) e `SITE_URL`.
3. Em Integrações → Webhooks, cadastre `https://SEU-DOMINIO/api/pagamentos/webhook` com um token seu e coloque o
   mesmo token em `ASAAS_WEBHOOK_TOKEN`. Marque os eventos de cobrança.

## Estoque e comanda (Fase 4)

- O estoque e a comanda ficam no BarberOS; a maquininha só recebe o pagamento.
- Saldo nunca muda "na mão": toda mudança é um movimento (entrada, venda, consumo, ajuste, perda, estorno) com
  quem fez e o saldo depois. Venda sem entrada deixa o saldo negativo e o painel avisa para conferir a contagem.
- Pagamento dividido (ex.: parte em dinheiro, parte no cartão). Cartão e Pix cobram o valor exato; só dinheiro
  recebe a mais e o sistema mostra o troco. Desconto, item avulso e cancelar: dono e recepção.
- Cancelar comanda fechada (só o dono) devolve os produtos ao estoque; o dinheiro/estorno é devolvido por fora.
- `npm run db:produtos` cria produtos de exemplo; `npm run teste:comandas` roda o fluxo completo (com uma
  Pagar.me falsa).

### Maquininha Stone (Connect 2.0)

`MAQUININHA` define como o cartão/Pix é recebido:

- `manual` (padrão em produção): a equipe digita o valor em qualquer maquininha e registra a forma aqui.
- `simulada` (padrão no computador): o pedido fica "esperando a maquininha" e um botão simula a aprovação.
- `stone`: o BarberOS manda o pedido direto para a maquininha pela API da Pagar.me (Stone Connect 2.0); o cliente
  só passa o cartão, o webhook da Pagar.me confirma sozinho (com NSU e bandeira) e o pedido sai da fila do POS.

Para ligar o modo `stone`:

1. Maquininha **S920 ou Q92**. Peça ao comercial da Stone a ativação do **Connect 2.0** (o software precisa estar
   no Programa de Parcerias da Stone) na mesma conta Pagar.me usada nas assinaturas.
2. `.env`: `MAQUININHA="stone"`, `STONE_POS_SERIAL` (número de série da maquininha, na etiqueta de trás),
   `PAGARME_SECRET_KEY` e `EMAIL_BALCAO` (e-mail usado nos pedidos de cliente sem cadastro).
3. O webhook é o mesmo das assinaturas (`/api/pagamentos/pagarme/webhook`, eventos `order.*` e `charge.*`).
   Se o webhook atrasar, o botão "Conferir" consulta o pedido na hora.
4. Estorno de cartão é feito na maquininha ou no portal da Stone (a API do Connect não estorna).

## Automações (Fase 5)

Configuradas pelo dono em **Configurações → Mensagens automáticas no WhatsApp** (rodam a cada 5 min; nada sai duas
vezes, e o histórico do que foi enviado fica na mesma tela):

- **Lembrete na véspera** (24 h antes, ajustável): pede para responder *SIM*. O bot entende a resposta e marca o
  atendimento como confirmado; se o cliente não puder, ele oferece remarcar.
- **Lembrete chegando a hora** (90 min antes, ajustável), com o endereço.
- **Depois da falta**: oferece um novo horário (se o cliente ainda não remarcou).
- **Limite de faltas**: com 2 faltas em 60 dias (ajustável), o cliente só marca falando com a equipe; o bot passa a
  conversa para vocês.
- **Agradecimento** depois do atendimento, com o link de avaliação no Google (desligado por padrão).
- **Chamar de volta quem sumiu** (desligado por padrão; até 15 por rodada).
- Tudo sai entre 8h e 21h (menos o lembrete de última hora). Quem responder **PARAR** não recebe mais nada automático.
- Fora da janela de 24 h do WhatsApp, as mensagens usam o modelo aprovado `WHATSAPP_TEMPLATE_AVISO` (crie na Meta
  um modelo de utilidade com o texto do aviso como variável).
- `npm run teste:automacoes` roda todas as regras contra o banco de desenvolvimento.

### Google Agenda

Em **Horários**, cada barbeiro tem o botão **Adicionar ao Google Agenda** (também funciona no iPhone e no Outlook): os
atendimentos e horários fechados aparecem no calendário do celular e atualizam sozinhos. É só leitura, com um link
secreto por barbeiro (dá para trocar se vazar) e sem telefone de cliente. O Google só lê o link com o sistema no ar
(`PAINEL_URL` com https).

Comissão dos barbeiros ficou de fora, como combinado.

## Indicadores

- **Indicadores** (`/indicadores`, dono): visão do negócio num período (7/30/90 dias, mês, mês passado, ano),
  sempre comparada com o período anterior do mesmo tamanho. Faturamento por fonte, gasto médio por cliente, ticket,
  ocupação (geral, por dia, por dia da semana e por barbeiro), faltas, clientes novos, frequência, retorno de novos,
  base ativa/sumindo/perdida, idade, como conheceram, quem mais gastou, assinaturas (MRR, churn, LTV, uso do plano,
  quanto sai cada corte do plano, motivos de cancelamento), bar e loja (ticket, margem, mais vendidos) e canais de
  agendamento. No topo, **leituras automáticas** apontam o que está fora do ideal e o próximo passo.
- **Ver detalhes** de cada barbeiro (`/indicadores/barbeiro/<id>`): ocupação vs equipe, atendimentos, ticket,
  clientes fiéis, horários mais procurados, serviços e produtos vendidos. O barbeiro vê só os dele ("Meus números").
- Idade e "como conheceu" vêm do cadastro: o cliente preenche no perfil do site, a equipe no cartão do atendimento e o
  bot pergunta ao cliente novo depois do primeiro agendamento. Com a data de nascimento dá para ligar o parabéns
  automático (Configurações → Mensagens automáticas).

## Lista de espera, retorno e indicação

- **Lista de espera de horário:** dia sem vaga no site (“Me avise se abrir horário”, com período do dia) ou no bot.
  A cada 5 min o sistema confere; abriu vaga (cancelamento, remarcação, agenda liberada), o cliente recebe as opções
  no WhatsApp e o bot marca na resposta. Justo com a fila: com 1 vaga, avisa o primeiro; se em 20 min ninguém pegar,
  avisa o próximo. Quem marcou por conta própria sai da lista; dia que passou expira. A equipe vê no painel.
- **Hora de voltar:** o sistema aprende o ritmo de cada cliente (média das últimas visitas, de 7 a 60 dias) e, um dia
  antes do ritmo, manda um lembrete com 2 horários livres do barbeiro de costume. Pula quem já tem horário, está na
  lista de espera ou ainda não pode usar o plano. Ligar em Configurações → Mensagens automáticas.
- **Indique e ganhe:** cada cliente tem um link (`/i/<código>`) e um código. Quem chega pelo link (ou fala o código
  no WhatsApp) ganha o desconto de boas-vindas; quem indicou ganha o prêmio quando o amigo faz o 1º corte, com aviso
  no WhatsApp. Os descontos aparecem na comanda do cliente (botão “Usar”) e voltam se a comanda for cancelada. Vale
  só para cliente novo, uma vez por pessoa e ninguém indica a si mesmo. Ligar e definir os valores em Configurações.
- `npm run teste:crescimento` roda as três contra o banco de desenvolvimento.

## Regras garantidas pelo sistema

- Dois atendimentos do mesmo barbeiro nunca se sobrepõem: restrição `EXCLUDE` no Postgres e trava por barbeiro.
- Atendimento só cabe dentro do expediente do dia e fora de períodos fechados.
- Cliente (bot e site): antecedência mínima, até N dias à frente, no máximo 2 horários futuros, sem dois
  horários no mesmo período, e só altera/cancela até 2h antes (configurável na tabela `configuracao`).
- Barbeiro só altera a própria agenda; recepção mexe em atendimentos mas não em expediente; dono faz tudo;
  cliente só vê e altera os próprios horários.
- Webhook do WhatsApp só aceita chamadas assinadas pela Meta e ignora mensagens repetidas.
- Toda alteração fica registrada na tabela `auditoria`.

## Estrutura

```
prisma/                 schema, migrações e seed
src/lib/agenda/         motor de disponibilidade e regras de agenda (equipe e cliente)
src/lib/bot/            bot: prompt, ferramentas, loop com o Claude, processamento por conversa
src/lib/whatsapp/       Cloud API, webhook, conversas e avisos
src/lib/auth/           login por código (OTP) e sessão
src/app/api/            API das telas, do cliente (/api/cliente) e webhook
src/lib/comandas/       estoque, comanda e maquininha (Stone Connect)
src/components/         telas (agenda, expediente, conversas, cliente, comandas)
tests/                  testes (npm test)
```

## Próximas fases

6. Produção: LGPD, backup, deploy (o que falta para subir)
