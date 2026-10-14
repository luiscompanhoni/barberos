# BarberOS

Sistema da barbearia Black Barber: agenda por barbeiro, bot do WhatsApp, área do cliente, assinaturas, comanda e
estoque, financeiro, RH e indicadores. Substitui o CashBarber.

## O que já está pronto

- **Fase 1:** agenda por barbeiro, tela da recepção ao vivo, app do barbeiro e painel do dono.
- **Fase 2:** bot do WhatsApp com Claude, conversas da equipe, simulador e área do cliente no site.
- **Fase 3:** assinaturas pela Pagar.me (Pix, cartão e boleto), regras de plano, lista de espera do plano e
  cancelamento com tentativa de retenção.
- **Fase 4:** estoque, comanda com pagamento dividido e maquininha Stone Connect 2.0.
- **Fase 5:** mensagens automáticas, Google Agenda dos barbeiros, indicadores, lista de espera de horário,
  "hora de voltar" e indique e ganhe.
- **Produção:** login com senha, WhatsApp oficial ou não oficial (Evolution), checkout próprio (planos, horário
  pago antes e links de pagamento), saldo e cashback, roleta de prêmios, financeiro (caixa, despesas, conciliação,
  estornos, resumo do mês), checklist da equipe, RH (comissões, pote de assinaturas e folha) e deploy em VPS com
  https e backup diário.
- **Troca de sistema:** importação do CashBarber (cadastro, clientes, assinantes, histórico de agendamentos e
  comandas, mensalidades e horários ainda marcados) e domínio próprio.

## Rodar localmente

Requisitos: Node 20+ e Docker.

```bash
cp .env.example .env          # depois troque SESSION_SECRET e coloque ANTHROPIC_API_KEY
docker compose up -d          # Postgres na porta 5433
npx prisma migrate dev        # cria as tabelas
npm run db:seed               # dados de exemplo
npm run dev                   # site: http://localhost:3000 · painel: http://painel.localhost:3000
```

Login por celular + senha (a equipe também pode usar um nome de usuário). No primeiro acesso, ou se esquecer a senha,
use **"Primeiro acesso ou esqueci a senha"**: chega um código no WhatsApp e, depois de entrar, a pessoa cria a senha.
Em teste local (`OTP_PROVIDER="console"`, fora de produção) o código aparece **na própria tela de login** (botão
"Usar"). Com `OTP_PROVIDER="whatsapp"` ele chega pelo WhatsApp (oficial ou não oficial).

| Quem      | Onde entra                              | Celular (seed)  |
|-----------|-----------------------------------------|-----------------|
| Dono      | `painel.localhost:3000/entrar`          | (11) 90000-0001 |
| Recepção  | `painel.localhost:3000/entrar`          | (11) 90000-0002 |
| Joao      | `painel.localhost:3000/entrar`          | (11) 90000-0011 |
| Pedro     | `painel.localhost:3000/entrar`          | (11) 90000-0012 |
| Lucas     | `painel.localhost:3000/entrar`          | (11) 90000-0013 |
| Clientes  | `localhost:3000/entrar`                 | qualquer celular ("Criar conta" com senha, ou entrar pelo código) |

Os usuários do seed não têm senha: entre pelo código e crie a senha. O dono também pode gerar uma senha temporária
para cada pessoa da equipe em **Configurações** (`/equipe`), e ela troca no primeiro acesso.

## Telas

O painel tem uma barra de abas no topo (até 8): troca de tela sem abrir abas do navegador e lembra a última página e
a rolagem de cada uma.

Equipe (dono e recepção; o que é só do dono está marcado):
- **Painel** (`/painel`): o que precisa de ação agora e o mapa de horários de pico.
- **Recepção** (`/recepcao`): uma coluna por barbeiro, horários livres em destaque. Clique no vazio para encaixar;
  arraste para mudar horário ou barbeiro; puxe a borda de baixo para mudar a duração. Atualiza ao vivo.
- **Comandas** (`/comandas`): uma comanda por cliente. Abra pelo atendimento na agenda (botão "Comanda": o
  serviço entra com o preço certo, zero se for pelo plano) ou avulsa no balcão. Toque nos produtos do bar/loja,
  use o saldo do cliente, receba em uma ou mais formas e feche: o estoque baixa no fechamento.
- **Conversas** (`/conversas`): acompanha o bot, assume a conversa e responde pelo painel;
  "Devolver para o bot" volta ao atendimento automático.
- **Semana** (`/semana`).
- **Assinaturas** (`/assinaturas`), **Estoque** (`/estoque`), **Financeiro** (`/financeiro`),
  **Checklist** (`/checklist`) e **Roleta** (`/roleta`): ver as seções abaixo.
- Só o dono: **Indicadores** (`/indicadores`), **RH** (`/rh`), **Planos** (`/planos`), **Horários**
  (`/expediente`: semana padrão, folga, dia extra, horário diferente, fechar agenda), **Configurações**
  (`/equipe`: dados da barbearia, mensagens automáticas, acessos da equipe, barbeiros com foto e serviços), **WhatsApp**
  (`/whatsapp`: conexão do número pelo QR code) e **Simulador** (`/simulador`, só com
  `WHATSAPP_PROVIDER="simulador"`: conversa como se fosse um cliente, pelo mesmo caminho do webhook).
- **Minha conta** (`/conta`, toda a equipe): senha e usuário de login.

Barbeiro: **Minha agenda** (`/minha-agenda`), **Barbearia hoje** (a tela da recepção), **Comandas**,
**Meus horários** e **Meus números** (os indicadores dele).

Cliente (`/c`): próximos horários (remarcar, cancelar e pagar antes), histórico, agendar em 4 passos
(serviço → barbeiro ou "qualquer um" → dia e hora → confirmar), planos (assinar e cancelar), saldo (cashback e
indicações), roleta de prêmios e perfil com preferências de corte e senha.

## Bot do WhatsApp

- Claude com ferramentas (`src/lib/bot/`): listar serviços, consultar horários, agendar, remarcar, cancelar,
  meus agendamentos, salvar nome e chamar atendente; planos e assinatura; links de pagamento; cancelamento do
  plano com retenção; lista de espera e indicação. O bot nunca inventa horário: sempre consulta a agenda.
- Modelo padrão `claude-opus-5-5` com effort baixo e fallback de recusa; troque com `BOT_MODELO`.
- Sem `ANTHROPIC_API_KEY`, o bot passa a conversa para a equipe e avisa o cliente.
- Quando a equipe remarca, troca o barbeiro ou cancela um atendimento, o cliente recebe aviso no WhatsApp.

`WHATSAPP_PROVIDER` escolhe o canal: `simulador` (nada sai do servidor), `cloud` (oficial da Meta) ou `evolution`
(não oficial, pelo QR code).

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

### WhatsApp não oficial (Evolution)

Conecta o número da barbearia pelo QR code, como o WhatsApp Web. Não tem custo por mensagem nem precisa de modelos
aprovados, mas não tem garantia da Meta: o número pode ser bloqueado se mandar mensagem em massa.

1. No `.env` do servidor: `WHATSAPP_PROVIDER="evolution"` e `COMPOSE_PROFILES="evolution"` (sobe o serviço
   `evolution` do `deploy/docker-compose.yml`). A `EVOLUTION_API_KEY` é gerada pelo `scripts/deploy.sh`.
2. Rode o deploy de novo e abra **WhatsApp** no painel (dono): no celular da barbearia, Configurações → Aparelhos
   conectados → Conectar aparelho, e aponte para o QR code.
3. Depois de conectado, mude `OTP_PROVIDER="whatsapp"`: o código de acesso vai como mensagem comum.

A Evolution roda no mesmo servidor, sem porta aberta, e guarda os dados no mesmo Postgres (schema próprio).

## Colocar em produção

A imagem Docker (`Dockerfile`) aplica as migrações sozinha ao subir e expõe `/api/saude` para o healthcheck.
Precisa de **um servidor Node sempre ligado + Postgres** (o tempo real e o bot rodam no processo; não use
hospedagem serverless).

### VPS (o que está no ar)

`deploy/docker-compose.yml` sobe o sistema, o Postgres, o Caddy (https automático pelo Let's Encrypt), o backup
diário e, se ligado, a Evolution. Para subir ou atualizar, na pasta do projeto (Git Bash):

```bash
bash scripts/deploy.sh root@IP-DO-VPS
```

- Na primeira vez, instala o Docker e cria `/opt/barberos/.env` a partir de `deploy/env.producao.exemplo`, com
  `DB_SENHA` e `SESSION_SECRET` aleatórios. Preencha `DONO_TELEFONE`, `ANTHROPIC_API_KEY` etc. e rode de novo.
- Nas próximas, só troca o código: o `.env` e os backups do servidor ficam.
- Backup: cópia do banco todo dia às 03h em `/opt/barberos/backups`, guardada por 14 dias.
- O banco não fica exposto: só os containers falam com ele.

Variáveis principais (a lista completa e comentada está em `deploy/env.producao.exemplo`):

| Variável | Valor |
|---|---|
| `SITE_URL`, `PAINEL_URL` | endereço do site e do painel, com https (ver "Site e painel") |
| `CADDY_ENDERECOS` | domínios que o Caddy atende (ex.: `blackbarber.com.br, www.blackbarber.com.br, painel.blackbarber.com.br`); `:80` para testar só pelo IP |
| `DONO_TELEFONE`, `DONO_NOME`, `NOME_BARBEARIA` | criam o dono no primeiro deploy (depois podem sair) |
| `ANTHROPIC_API_KEY` | chave do Claude |
| `WHATSAPP_*`, `OTP_PROVIDER` | ver "Bot do WhatsApp". Enquanto `OTP_PROVIDER="console"`, o código de login aparece só no log do servidor (`docker compose logs app`) |
| `PAGAMENTOS_PROVIDER`, `PAGARME_*`, `COBRANCA_*` | ver "Ligar a Pagar.me" |
| `MAQUININHA`, `STONE_POS_*` | ver "Maquininha Stone" |

**Railway (alternativa):** New Project → Deploy from GitHub repo (detecta o Dockerfile) → Add PostgreSQL →
preencha as variáveis (`DATABASE_URL` do Postgres e `SESSION_SECRET` com 64 caracteres aleatórios) → Settings →
Networking → Generate Domain (ou seu domínio próprio). Lá não há Evolution nem o backup do compose.

### Site e painel (dois endereços, um sistema)

- Site (`SITE_URL`): a página inicial é a de venda dos planos; `/entrar` é o login do cliente, que agenda, vê
  horários e paga por ali. Links de pagamento enviados no WhatsApp também usam esse endereço.
- Painel (`PAINEL_URL`): o sistema da equipe (agenda, comandas, estoque, conversas, configurações).
- O mesmo serviço atende os dois. Página de equipe aberta no site vai para o painel e vice-versa; os logins são
  separados. Sem `PAINEL_URL`, tudo fica num endereço só.
- DNS: `painel` é um CNAME (ou registro A) comum. O domínio sem "www" precisa apontar para o servidor; no
  Registro.br, use registro A para o IP do VPS (CNAME no topo não funciona lá).
- Webhooks (Meta, Pagar.me) podem usar qualquer um dos dois; use o do painel.
- No computador: `SITE_URL=http://localhost:3000` e `PAINEL_URL=http://painel.localhost:3000` (o navegador já
  entende `*.localhost`, sem configurar nada).

### Trocar de domínio

- Ajuste `SITE_URL`, `PAINEL_URL` e `CADDY_ENDERECOS` e rode o deploy.
- `CADDY_PAINEL_ANTIGO`: endereço antigo do painel (ex.: o provisório `sslip.io`). Quem entrar por ele vai para o
  `PAINEL_URL` novo.
- `CADDY_IP`: IP do servidor. Quem digitar só o IP vai para o painel.
- Atualize as URLs dos webhooks na Meta e na Pagar.me se usavam o endereço antigo.

## Assinaturas (Fase 3)

- **Planos** (`/planos`, dono): preço, serviços incluídos (à vontade ou N por mês), dias entre usos, horários por vez,
  dias da semana, vagas, desconto nos extras, formas de pagamento (um plano só aceita Pix, cartão e boleto) e
  barbeiros que atendem. Mudar o preço vale só para novas adesões.
- **Assinaturas** (`/assinaturas`, dono e recepção): assinantes, receita recorrente, vendas × cancelamentos do mês,
  motivos de cancelamento, retenção, venda no balcão (gera o link e manda no WhatsApp), cobrar atrasado, cancelar.
- **Cliente** (`/c/planos`): assina e paga no checkout do BarberOS (o sistema nunca vê dados de cartão) e entra na
  lista de espera se lotar.
- **Bot**: apresenta os planos, assina (pede o CPF e manda o link), explica as regras do plano, oferece avulso com o
  desconto de assinante, manda o link de mensalidade atrasada e tenta reter antes de cancelar.
- **Na agenda**: o serviço coberto sai por R$ 0 (selo "Assinante"); quando a regra não cobre, o sistema explica e
  oferece marcar como avulso. Ao ativar o plano, horários já marcados passam a sair pelo plano.
- **Pagamentos**: ativa ao pagar, fica "atrasada" (ainda vale por `toleranciaAtrasoDias`, padrão 3) e depois
  suspende; o cliente recebe os avisos no WhatsApp. O webhook confere o token e busca o status real no gateway.
- **Testar sem gateway**: `PAGAMENTOS_PROVIDER="simulado"`. A fatura vira uma tela de teste com o botão "Pagar"; no
  detalhe da assinatura há botões para simular pagamento, atraso e o próximo mês. Em produção, pagamento simulado só
  é confirmado pela equipe. `npm run teste:assinaturas` roda o ciclo completo no banco de desenvolvimento.

### Cancelamento pelo cliente, com retenção

O cliente cancela na área dele (`/c/planos/cancelar`) ou pelo bot, informando o motivo. Antes de cancelar, o
sistema faz uma oferta conforme o motivo:

| Motivo | Oferta |
|---|---|
| Ficou caro | desconto (padrão 20% por 2 meses; no máximo um por ano) |
| Não estou usando / vou viajar | pausa de 30, 60 ou 90 dias (até o máximo do dono, padrão 60; no máximo uma a cada 6 meses) |
| Insatisfeito / horários não batem | conversa com o gerente (passa para a equipe em Conversas) |
| Mudei de cidade / outro | cancela direto |

- O plano continua valendo até o fim do ciclo já pago; quando o ciclo acaba, vira cancelado e os horários marcados
  depois disso passam a ser avulsos. A pausa empurra a próxima cobrança e o plano volta sozinho no fim dela.
- Pagar.me aplica pausa e desconto sozinha. Nos outros meios (Celcash, Asaas, assinaturas do CashBarber) a oferta
  vira "falar com o gerente".
- O dono é avisado no WhatsApp. Em **Assinaturas** ele acompanha a retenção e liga, desliga e ajusta as ofertas.

### Pagamentos online (checkout do BarberOS)

O cliente paga no próprio site, por Pix ou cartão (o número do cartão vai do navegador direto para a Pagar.me e vira
token). O mesmo checkout atende:

- **Planos**: adesão e mensalidades (`/c/assinar/<código>` e `/c/pagar/<código>`).
- **Horário pago antes** (`/c/pagar-horario/<id>`): o valor entra sozinho na comanda do atendimento. Se o horário
  for cancelado depois de pago, o valor vira saldo do cliente.
- **Links de pagamento** (Financeiro → Links de pagamento): a equipe cria uma cobrança avulsa (ou de uma comanda
  aberta) e manda `/c/link/<código>` no WhatsApp. Pago, o cliente recebe o aviso e o valor entra na comanda aberta.

Há limite de tentativas de cartão por hora, contra teste de cartões em massa.

### Ligar a Pagar.me (Stone) - meio de pagamento escolhido

A API "Stone Online" só aceita cartão, não tem página de pagamento nem webhooks e exigiria que o sistema recebesse
o número do cartão (certificação PCI DSS). Por isso a cobrança é feita pela **Pagar.me**, do grupo Stone:

| Forma | Como funciona |
|---|---|
| Cartão | O cliente digita no checkout do BarberOS; o número vai do navegador direto para a Pagar.me e vira token. A Pagar.me cobra todo mês. Cartão recusado: o cliente recebe o link para trocar o cartão. |
| Boleto | Assinatura na Pagar.me; o boleto de cada mês aparece em `/c/pagar/<código>`. |
| Pix | A Pagar.me não faz Pix recorrente: o BarberOS gera o Pix do mês 3 dias antes do vencimento e manda no WhatsApp. A página mostra QR + copia e cola e atualiza sozinha quando o pagamento cai. |

1. Peça a conta Pagar.me ao seu comercial da Stone e pegue as chaves de teste (`sk_test_`/`pk_test_`).
2. `.env`: `PAGAMENTOS_PROVIDER="pagarme"`, `PAGARME_SECRET_KEY`, `PAGARME_PUBLIC_KEY`, `PAGARME_WEBHOOK_TOKEN`,
   `SITE_URL`, `NOME_FATURA` e o endereço de cobrança da barbearia (`COBRANCA_ENDERECO`, `COBRANCA_CEP`,
   `COBRANCA_CIDADE`, `COBRANCA_UF`), que a Pagar.me exige no cartão.
3. Na dashboard da Pagar.me: cadastre o domínio do sistema (exigido para o cartão) e o webhook
   `https://SEU-DOMINIO/api/pagamentos/pagarme/webhook?token=<PAGARME_WEBHOOK_TOKEN>` com os eventos
   `charge.*`, `invoice.*`, `order.*` e `subscription.canceled`.
4. `npm run teste:pagarme` e `npm run teste:checkout` rodam os fluxos contra uma Pagar.me falsa (sem chamadas reais).
5. Faça um teste real no ambiente de teste da Pagar.me antes de trocar para as chaves de produção.

### Celcash (registros antigos)

A Celcash (cel_payments, antiga Galax Pay) continua integrada para as assinaturas e cobranças criadas por ela: a
própria Celcash gera o Pix (ou boleto) de cada mês e o cartão é cadastrado no link dela. Variáveis `CELCASH_*` em
`deploy/env.producao.exemplo`; webhook `https://PAINEL/api/pagamentos/celcash/webhook?token=<CELCASH_WEBHOOK_TOKEN>`.
Estornos e ofertas de retenção da Celcash são feitos à mão pela equipe.

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
- O saldo do cliente (cashback, prêmios e indicação) aparece na comanda e vira desconto.
- Cancelar comanda fechada (só o dono) devolve os produtos ao estoque; o dinheiro volta pelo estorno.
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
2. `.env`: `MAQUININHA="stone"`, `STONE_POS_SERIAL` (número de série, na etiqueta de trás; várias maquininhas
   separadas por vírgula, e a equipe escolhe em qual cobrar), `STONE_POS_NOMES` (opcional, nomes na mesma ordem),
   `PAGARME_SECRET_KEY` e `EMAIL_BALCAO` (e-mail usado nos pedidos de cliente sem cadastro).
3. O webhook é o mesmo das assinaturas (`/api/pagamentos/pagarme/webhook`, eventos `order.*` e `charge.*`).
   Se o webhook atrasar, o botão "Conferir" consulta o pedido na hora.
4. Estorno: o sistema tenta pela API; se não der, é feito na própria maquininha ou no portal da Stone.

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
- **Parabéns** no aniversário (precisa da data de nascimento no cadastro).
- Tudo sai entre 8h e 21h (menos o lembrete de última hora). Quem responder **PARAR** não recebe mais nada automático.
- Fora da janela de 24 h do WhatsApp oficial, as mensagens usam o modelo aprovado `WHATSAPP_TEMPLATE_AVISO` (crie na
  Meta um modelo de utilidade com o texto do aviso como variável).
- `npm run teste:automacoes` roda todas as regras contra o banco de desenvolvimento.

### Google Agenda

Em **Horários**, cada barbeiro tem o botão **Adicionar ao Google Agenda** (também funciona no iPhone e no Outlook): os
atendimentos e horários fechados aparecem no calendário do celular e atualizam sozinhos. É só leitura, com um link
secreto por barbeiro (dá para trocar se vazar) e sem telefone de cliente. O Google só lê o link com o sistema no ar
(`PAINEL_URL` com https).

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
  bot pergunta ao cliente novo depois do primeiro agendamento.

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
  no WhatsApp. Os descontos entram no saldo do cliente e voltam se a comanda for cancelada. Vale só para cliente
  novo, uma vez por pessoa e ninguém indica a si mesmo. Ligar e definir os valores em Configurações.
- `npm run teste:crescimento` roda as três contra o banco de desenvolvimento.

## Saldo, cashback e roleta

- **Saldo do cliente** (`/c/saldo`): soma do cashback, dos prêmios da roleta e das indicações que ainda não venceram,
  com o extrato. Na comanda, vira desconto (usa primeiro o que vence antes).
- **Cashback**: uma porcentagem do que o cliente paga (corte, bar e loja) volta como saldo, com validade. O dono
  define a porcentagem e os dias em Configurações. Se a comanda for cancelada, o cashback dela deixa de valer.
- **Roleta de prêmios** (`/roleta`; cliente em `/c/roleta`): o cliente ganha giros por atendimento concluído (e/ou
  um giro grátis a cada N dias). O dono define os prêmios (texto, valor, cor, limite por mês e chance), o bônus do
  assinante nos prêmios em dinheiro e a validade. O sorteio é feito no servidor. Dinheiro vira saldo; brinde fica
  "a retirar" e a recepção entrega no balcão. `npm run teste:roleta`.

## Financeiro

**Financeiro** (`/financeiro`, dono e recepção; o resumo do mês só o dono):

- **Caixa**: abre com o fundo de troco, registra sangrias e suprimentos e fecha com a contagem. O esperado em dinheiro
  sai dos pagamentos das comandas feitos com o caixa aberto. O extrato mostra tudo do turno, em ordem, com o saldo da
  gaveta linha a linha.
- **Despesas** (contas a pagar): paga com dinheiro do caixa vira sangria; despesa recorrente, ao ser paga, cria a do
  mês seguinte.
- **Links de pagamento**: ver "Pagamentos online".
- **Estornos**: ver abaixo.
- **Conciliação**: por dia e meio de recebimento, o bruto registrado, a taxa, o líquido esperado e a data prevista do
  depósito, contra o que caiu na conta. O dono configura as taxas e prazos de cada meio. Dinheiro é conferido no caixa.
- **Resumo do mês** (dono): receitas, despesas pagas e o resultado, comparando com o mês anterior, sem contar nada
  duas vezes (pago antes e links entram na data do pagamento; estorno desconta na data em que foi feito).

`npm run teste:financeiro` e `npm run teste:despesas`.

### Estornos

- A recepção pede o estorno (pagamento da comanda, horário pago antes, link ou mensalidade, inteiro ou parcial); o
  pedido fica pendente, o dono é avisado no WhatsApp e vê um contador no menu Financeiro.
- O dono aprova, recusa ou estorna direto. Aprovado, o sistema devolve pelo meio certo: Pagar.me (online), Stone
  Connect (ou na própria maquininha), dinheiro (sai do caixa como sangria) ou "por fora" (maquininha manual, Celcash).
- Se o meio de pagamento recusar, o estorno fica como falhou e nada muda. `npm run teste:estorno`.

## Equipe: checklist e RH

- **Checklist** (`/checklist`, dono e recepção): tarefas por função (diarista, barbeiro, gerente) e dia da semana.
  De manhã cada pessoa recebe a lista no WhatsApp, com um link para marcar sem login (`/t/<código>`); à noite sai o
  resumo das pendências. O gerente valida a tarefa (a pessoa ganha os pontos) ou dá "re" (marcou sem fazer: perde
  pontos e a tarefa volta). Faixas BLACK ELITE, BLACK PLATINA e BLACK LEGEND, com classificação.
- **RH** (`/rh`, só o dono, porque tem salários):
  - **Funcionários**: ficha de cada pessoa (o mesmo cadastro do checklist).
  - **Comissões**: regra por serviço, avulso (% do preço cobrado ou valor fixo) e plano (% do preço de tabela ou
    valor fixo por corte), com exceção por barbeiro. Sugestão inicial: avulso 40% e plano R$ 15,00 por corte.
  - **Pote de assinaturas** (como o Dpote do CashBarber): uma % do faturamento de mensalidades do período, dividida
    pelas fichas dos atendimentos de plano, com ajuste por barbeiro (adicional ou percentual diferente). Ligado,
    substitui a regra de plano de cada serviço.
  - **Comissão de produtos** por faixa de venda no período, separada para loja e bar.
  - **Relatório de comissões** por período, a partir dos atendimentos concluídos.
  - **Folha de pagamento** por mês: prévia ao vivo, lançamentos (vale pode sair do caixa como sangria), fechar
    (congela), marcar como paga (vira despesa), reabrir e exportar CSV.
  - `npm run teste:rh`.

## Importação do CashBarber (troca de sistema)

Scripts em `scripts/`, rodados com `DATABASE_URL=... npx tsx scripts/<script>.ts`. Os CSVs têm dados pessoais: não
copie para dentro do projeto. Todos podem rodar de novo sem duplicar. Os que aceitam `--aplicar` só mostram o que
fariam até receberem essa opção.

1. `importar-cashbarber.ts`: serviços, barbeiros (com serviços, durações e horários), planos e produtos, a partir
   de `scripts/dados/cashbarber.json`.
2. `importar-clientes-cashbarber.ts <Clientes.csv>`: clientes (telefone repetido vira um cadastro só; cliente que já
   existe só ganha CPF, e-mail e nascimento que faltavam).
3. `importar-assinantes-cashbarber.ts <Relatorio19.csv> [--aplicar]`: liga os assinantes aos clientes pelo nome. A
   cobrança continua no CashBarber: o BarberOS não cobra nem avisa essas assinaturas.
4. `importar-historico-cashbarber.ts <pasta> [--ate=AAAA-MM-DD|agora] [--futuros] [--aplicar]`: agendamentos e
   comandas fechadas com os pagamentos. Nenhuma mensagem sai por causa do histórico. Na virada, `--ate=agora
   --futuros` traz também os horários ainda marcados, que passam a receber os lembretes do BarberOS.
5. `importar-mensalidades-cashbarber.ts <pasta> [--ate=...] [--aplicar]`: mensalidades pagas como cobranças pagas;
   quem já saiu do plano ganha uma assinatura cancelada de histórico.

Depois, confira com `relatorio-migracao.ts [--clientes=Clientes.csv] [--assinantes=Relatorio19.csv] [--saida=pasta]`.
Ele só lê o banco e mostra:
- clientes vindos do CashBarber e dados completos;
- histórico, última visita por faixa e frequência;
- assinaturas e mensalidades;
- possíveis duplicados (mesmo nome em telefones diferentes);
- dados incompletos.

Com os CSVs do CashBarber, mostra também quem ficou de fora e por quê. Com `--saida`, grava as listas em CSV para
abrir no Excel (fora da pasta do projeto).

## Testes

- `npm test`: testes unitários (Vitest, sem banco).
- `npm run teste:<área>`: fluxos completos contra o banco de desenvolvimento, com gateways falsos (sem chamadas
  reais): `assinaturas`, `pagarme`, `checkout`, `antecipado`, `cancelamento`, `comandas`, `automacoes`,
  `crescimento`, `login`, `roleta`, `financeiro`, `despesas`, `estorno` e `rh`.

## Regras garantidas pelo sistema

- Dois atendimentos do mesmo barbeiro nunca se sobrepõem: restrição `EXCLUDE` no Postgres e trava por barbeiro.
- Atendimento só cabe dentro do expediente do dia e fora de períodos fechados.
- Cliente (bot e site): antecedência mínima, até N dias à frente, no máximo 2 horários futuros, sem dois
  horários no mesmo período, e só altera/cancela até 2h antes (configurável na tabela `configuracao`).
- Barbeiro só altera a própria agenda; recepção mexe em atendimentos mas não em expediente; dono faz tudo;
  cliente só vê e altera os próprios horários.
- Senhas guardadas com scrypt; login errado não revela se a conta existe. O sistema nunca vê o número do cartão.
- Estorno nunca passa do valor pago, e quem aprova é o dono.
- Webhook do WhatsApp só aceita chamadas assinadas pela Meta e ignora mensagens repetidas.
- Toda alteração fica registrada na tabela `auditoria`.

## Estrutura

```
prisma/                 schema, migrações, seed e scripts de dados de exemplo
scripts/                testes de fluxo (teste-*), importação do CashBarber e deploy.sh
deploy/                 docker-compose de produção (app, Postgres, Caddy, backup, Evolution) e .env de exemplo
src/lib/agenda/         motor de disponibilidade, regras de agenda e horário pago antes
src/lib/bot/            bot: prompt, ferramentas, loop com o Claude, processamento por conversa
src/lib/whatsapp/       Cloud API, Evolution, webhook, conversas e avisos
src/lib/auth/           login por senha e por código (OTP) e sessão
src/lib/assinaturas/    planos, cobranças, regras e cancelamento com retenção
src/lib/pagamentos/     Pagar.me, Celcash, Asaas, simulado e checkout
src/lib/comandas/       estoque, comanda e maquininha (Stone Connect)
src/lib/crescimento/    lista de espera, indicação, saldo e cashback
src/lib/roleta/         roleta de prêmios
src/lib/financeiro/     caixa, despesas, extrato, conciliação e resumo
src/lib/estornos/       pedidos e execução de estornos
src/lib/checklist/      checklist da equipe e pontos
src/lib/rh/             comissões, pote, folha e funcionários
src/lib/indicadores/    indicadores do negócio e por barbeiro
src/lib/automacoes/     mensagens automáticas e calendário .ics
src/app/api/            API das telas, do cliente (/api/cliente) e webhooks
src/components/         telas
tests/                  testes unitários (npm test)
```

## Próximos passos

- **LGPD:** termo de uso e privacidade, consentimento do cliente e pedido de exclusão/exportação dos dados.
- **Backup fora do servidor:** hoje a cópia diária fica no próprio VPS; falta mandar uma cópia para outro lugar.
