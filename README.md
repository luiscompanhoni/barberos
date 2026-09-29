# BarberOS

Sistema de atendimento da barbearia: agenda por barbeiro, bot do WhatsApp, área do cliente, assinaturas e estoque.

- **Fase 1 (pronta):** agenda, app do barbeiro, tela da recepção e painel do dono.
- **Fase 2 (pronta):** bot do WhatsApp com Claude, conversas da equipe, simulador e área do cliente no site.

## Rodar localmente

Requisitos: Node 20+ e Docker.

```bash
cp .env.example .env          # depois troque SESSION_SECRET e coloque ANTHROPIC_API_KEY
docker compose up -d          # Postgres na porta 5433
npx prisma migrate dev        # cria as tabelas
npm run db:seed               # dados de exemplo
npm run dev                   # http://localhost:3000
```

Login por celular + código. Em teste local (`OTP_PROVIDER="console"`, fora de produção) o código aparece
**na própria tela de login** (botão "Usar"). Com `OTP_PROVIDER="whatsapp"` ele chega por WhatsApp.

| Quem      | Onde entra        | Celular (seed)  |
|-----------|-------------------|-----------------|
| Dono      | `/entrar`         | (11) 90000-0001 |
| Recepção  | `/entrar`         | (11) 90000-0002 |
| Joao      | `/entrar`         | (11) 90000-0011 |
| Pedro     | `/entrar`         | (11) 90000-0012 |
| Lucas     | `/entrar`         | (11) 90000-0013 |
| Clientes  | `/c/entrar`       | qualquer celular (o cadastro é criado no primeiro acesso) |

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
| `SESSION_SECRET` | 64 caracteres aleatórios (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) |
| `ANTHROPIC_API_KEY` | chave do Claude |
| `DONO_TELEFONE`, `DONO_NOME`, `NOME_BARBEARIA` | criam o dono no primeiro deploy (depois podem sair) |
| `WHATSAPP_*`, `OTP_PROVIDER` | ver "Ligar o WhatsApp oficial". Enquanto `OTP_PROVIDER="console"`, o código de login aparece só no log do servidor |

**Railway (recomendado para começar):** New Project → Deploy from GitHub repo (detecta o Dockerfile) → Add
PostgreSQL → preencha as variáveis → Settings → Networking → Generate Domain (ou seu domínio próprio).

**VPS (Hostinger, DigitalOcean...):** `docker build -t barberos .` e `docker run -d -p 3000:3000 --env-file .env
barberos`, com Postgres gerenciado ou em outro container e um proxy com HTTPS (Caddy ou Nginx) na frente.

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
src/components/         telas (agenda, expediente, conversas, cliente)
tests/                  testes (npm test)
```

## Próximas fases

3. Assinaturas e pagamentos (Asaas)
4. Estoque e comanda (bar + produtos; importação das vendas da Stone)
5. Automações: lembretes, faltas, comissões, Google Agenda, integração direta com a maquininha
6. Produção: LGPD, backup, deploy
