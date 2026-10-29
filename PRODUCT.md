# BarberOS

Sistema de gestão da barbearia Black Barber, em produção. Substitui o CashBarber.

## Problema e objetivo

A barbearia operava agenda, assinaturas, comandas e financeiro no CashBarber, com cobrança de assinaturas pela
Celcash. O BarberOS concentra num sistema próprio a agenda por barbeiro, o atendimento pelo WhatsApp (bot com
Claude), a área do cliente, assinaturas e pagamentos, comanda e estoque, financeiro com conciliação, RH e
indicadores, e importa o histórico do CashBarber (ver [Importação do CashBarber](docs/architecture.md#importação-do-cashbarber)).

Entregas já feitas:

- **Fase 1:** agenda por barbeiro, tela da recepção ao vivo, app do barbeiro e painel do dono.
- **Fase 2:** bot do WhatsApp com Claude, conversas da equipe, simulador e área do cliente no site.
- **Fase 3:** assinaturas pela Pagar.me (Pix, cartão e boleto), regras de plano, lista de espera do plano e
  cancelamento com retenção.
- **Fase 4:** estoque, comanda com pagamento dividido e maquininha Stone Connect 2.0.
- **Fase 5:** mensagens automáticas, Google Agenda dos barbeiros, indicadores, lista de espera de horário, "hora de
  voltar" e indique e ganhe.
- **Produção:** login com senha, WhatsApp oficial ou Evolution, checkout próprio, saldo e cashback, jogos de
  recompensa, financeiro (caixa, despesas, conciliação, estornos, resumo do mês), checklist, RH, campanhas,
  auditoria, permissões, deploy em VPS com https, backup diário e homologação.
- **Troca de sistema:** importação do CashBarber (cadastro, clientes, assinantes, histórico de agendamentos e
  comandas, mensalidades e horários ainda marcados) e domínio próprio.

## Público e papéis

- **Dono** (proprietário): pode tudo. Cria acessos, muda papéis e edita a matriz de permissões.
- **Gerente** (administrador): o que a recepção faz + serviços, barbeiros, produtos, planos, horários de todos,
  jogos e configurações; o resto pela matriz de permissões.
- **Líder de equipe**: reuniões e acompanhamento da equipe; pode continuar atendendo com o mesmo cadastro. Lucro e comissões de terceiros exigem autorização individual ou por função.
- **Recepção**: agenda, comandas, caixa, conversas, assinaturas (sem cancelar) e entrega de prêmios no balcão.
- **Barbeiro**: Minha agenda (`/minha-agenda`), Barbearia hoje (tela da recepção), Comandas, Meus horários e Meus
  números (os indicadores dele). Só altera a própria agenda.
- **Cliente**: área do cliente em `/c` no site (agendar, planos, pagamentos, saldo, jogos e prêmios, perfil).

Papéis no banco: enum `Papel` (`DONO`, `GERENTE`, `LIDER`, `RECEPCAO`, `BARBEIRO`, `CLIENTE`) em `prisma/schema.prisma`.

### Matriz de permissões (padrão)

O dono liga e desliga por papel em Configurações → Permissões e define exceções individuais em Acessos → Editar cadastro. Regras em `src/lib/auth/permissoes-regras.ts`; o
servidor confere tudo, a tela só esconde. A mudança vale na hora (papel e permissões são lidos a cada requisição) e
vai para a auditoria com o antes → depois. Acessos, Permissões, WhatsApp e Auditoria são sempre só do dono.

| Ação | Gerente | Recepção | Barbeiro |
|---|---|---|---|
| Aprovar e fazer estornos (sem isso, só pede) | não | não | — |
| Dar desconto na comanda | sim | sim | não |
| Usar o saldo do cliente | sim | sim | sim |
| Cancelar assinaturas e mudar ofertas de retenção | não | não | — |
| Mexer no caixa (abrir, fechar, sangria, suprimento) | sim | sim | — |
| Alterar comissões | não | não | — |
| Folha e salários | não | não | — |
| Excluir e desfazer lançamentos (comanda fechada, conta a pagar, despesa paga) | não | não | — |
| Ver faturamento (indicadores, pico, resultado dos jogos) | sim | não | — |
| Ver despesas e lucro (resumo do mês, resultado Celcash e Stone, visão financeira do painel) | não | não | — |

## Fluxos e telas

Dois endereços, um sistema: o **site** (`SITE_URL`: página de venda dos planos em `/`, login do cliente em
`/entrar`, área do cliente e links de pagamento) e o **painel** (`PAINEL_URL`: sistema da equipe). Logins
separados; página de um aberta no outro é redirecionada (`src/proxy.ts`).

Painel da equipe (barra de abas no topo, até 8, que lembra a última página e a rolagem de cada uma):

- **Painel** (`/painel`): o que precisa de ação agora e o mapa de horários de pico.
- **Recepção** (`/recepcao`): uma coluna por barbeiro, horários livres em destaque. Clique no vazio para encaixar;
  arraste para mudar horário ou barbeiro; puxe a borda de baixo para mudar a duração. Atualiza ao vivo.
- **Comandas** (`/comandas`), **Conversas** (`/conversas`: acompanha o bot, assume e devolve a conversa),
  **Semana** (`/semana`), **Assinaturas**, **Estoque**, **Financeiro**, **Checklist** e **Jogos** (`/jogos`;
  `/roleta` é o endereço antigo).
- Dono e gerente: **Campanhas**, **Planos**, **Horários** (`/expediente`: semana padrão, folga, dia extra, horário
  diferente, fechar agenda) e **Configurações** (`/equipe`: dados da barbearia, mensagens automáticas, barbeiros com
  foto e serviços).
- Pela matriz: **Indicadores** (`/indicadores`) e **RH** (`/rh`).
- Só o dono: **Acessos**, **Permissões**, **Backups** (em Configurações), **WhatsApp** (`/whatsapp`: conexão pelo QR
  code), **Auditoria** (`/auditoria`) e **Simulador** (`/simulador`, só com `WHATSAPP_PROVIDER="simulador"`).
- **Minha conta** (`/conta`, toda a equipe): senha e usuário de login.

Cliente (`/c`): tela inicial com plano em aberto, jogadas e prêmios, próximos horários (remarcar, cancelar e pagar
antes), agendar em 4 passos (serviço → barbeiro ou "qualquer um" → dia e hora → confirmar), planos (assinar e
cancelar), saldo (cashback e indicações), jogos e "Meus prêmios", histórico e perfil com preferências de corte e
senha. Páginas públicas sem login: `/c/pagar/`, `/c/assinar/`, `/c/link/`, `/c/r/` (link rastreado), `/i/`
(indicação) e `/t/` (checklist).

Login: celular + senha (a equipe também pode usar nome de usuário). "Primeiro acesso ou esqueci a senha" manda um
código pelo WhatsApp (`OTP_PROVIDER="whatsapp"`); em teste local (`OTP_PROVIDER="console"`, fora de produção) o
código aparece na própria tela de login. O dono pode gerar senha temporária para a equipe em Configurações.

A atualização de equipe acrescenta **Reuniões** (`/reunioes`), **Meu dia** (`/meu-dia`), **Presença e desempenho** (`/desempenho`), **Avaliações dos clientes** (`/avaliacoes`) e **Recompra e custos** (`/recompras`, dono). O cliente avalia em `/c/avaliacoes`. A agenda passa a selecionar intervalos vazios, bloquear com permissão individual, configurar cadeiras e mostrar encaixes por serviço. Implementação local; publicação e ativação de regras comerciais são separadas. Consulte [Configurar a evolução da equipe](docs/evolucao-equipe.md).

**App e notificações** (`/notificacoes` e `/c/notificacoes`): instalação na tela inicial, central privada, preferências por assunto e gerenciamento dos próprios aparelhos. Lembretes de agenda, avaliação interna, recompra com adesão e resumo diário do profissional alimentam a central e o push opcional. O aviso na tela bloqueada é genérico. Sem conexão, aparece uma página pública; operações exigem internet. Configuração e limites em [Aplicativo no celular](docs/app-notificacoes.md).

## Módulos presentes

- **Agenda**: motor de disponibilidade por barbeiro, expediente, exceções e bloqueios; horário pago antes; lista de
  espera de horário; Google Agenda por barbeiro (link `.ics` secreto, só leitura, sem telefone de cliente, trocável).
- **Bot do WhatsApp** (`src/lib/bot/`): Claude com ferramentas para serviços, horários, agendar, remarcar, cancelar,
  planos, assinatura, links de pagamento, cancelamento com retenção, lista de espera e indicação. Nunca inventa
  horário. Modelo padrão `claude-opus-5-5` com effort baixo e fallback de recusa (troca com `BOT_MODELO`). Sem
  `ANTHROPIC_API_KEY`, passa a conversa para a equipe e avisa o cliente. Quando a equipe remarca, troca o barbeiro
  ou cancela, o cliente é avisado.
- **Comandas e estoque**: uma comanda por cliente, aberta pelo atendimento (serviço com o preço certo, zero pelo
  plano) ou avulsa no balcão. Produtos do bar/loja, item avulso e desconto (pela matriz), saldo do cliente como desconto, pagamento dividido (só dinheiro recebe a
  mais e mostra troco), estoque baixa no fechamento. Todo saldo de estoque muda por movimento (entrada, venda,
  consumo, ajuste, perda, estorno) com autor e saldo depois; venda sem entrada deixa negativo e o painel avisa.
  Cancelar comanda fechada devolve os produtos; o dinheiro volta pelo estorno.
  **Serviço adicional** (`src/lib/comandas/adicional.ts`): serviço extra na comanda vira atendimento ligado ao
  principal (comissão, uso do plano e relatórios contam normal) sem ocupar a agenda.
- **Assinaturas** (`/planos`, `/assinaturas`, `/c/planos`): planos com preço, serviços incluídos (à vontade ou N por
  mês), dias entre usos, horários por vez, dias da semana, vagas, desconto nos extras, formas de pagamento e
  barbeiros (um plano só aceita Pix, cartão e boleto). Mudar o preço vale só para novas adesões. Tela Assinaturas
  (dono e recepção): assinantes, receita recorrente, vendas × cancelamentos, motivos, retenção, venda no balcão
  (gera o link e manda no WhatsApp), cobrar atrasado. Cliente assina no checkout e entra na lista de espera se
  lotar. O bot apresenta os planos, assina (pede o CPF e manda o link), explica as regras, oferece avulso com
  desconto de assinante e manda o link de mensalidade atrasada. Na agenda, serviço coberto sai por R$ 0 (selo
  "Assinante"); quando a regra não cobre, o sistema explica e oferece avulso; ao ativar o plano, horários já
  marcados passam a sair pelo plano. Ativa ao pagar, fica "atrasada" (ainda vale por `toleranciaAtrasoDias`, padrão
  3) e depois suspende, com avisos no WhatsApp; o webhook confere o token e busca o status real no gateway.
  Cobrança nova pela Pagar.me; assinaturas antigas continuam na Celcash (estornos e retenção dela à mão;
  mensalidades históricas importadas por `scripts/importar-mensalidades-celcash.ts`). Asaas é alternativa.
- **Cancelamento com retenção**: oferta conforme o motivo — ficou caro: desconto (padrão 20% por 2 meses, no máximo
  um por ano); não estou usando/vou viajar: pausa de 30, 60 ou 90 dias (máximo do dono, padrão 60; uma a cada 6
  meses); insatisfeito/horários: conversa com o gerente (vai para Conversas); mudei de cidade/outro: cancela direto.
  Pelo site (`/c/planos/cancelar`) ou pelo bot. O plano vale até o fim do ciclo pago; depois vira cancelado e os
  horários seguintes passam a avulsos. A pausa empurra a próxima cobrança e o plano volta sozinho. Pagar.me aplica
  pausa e desconto sozinha; nos outros meios (Celcash, Asaas, assinaturas do CashBarber) a oferta vira "falar com o
  gerente". O dono é avisado no WhatsApp e liga, desliga e ajusta as ofertas em Assinaturas.
- **Pagamentos online** (checkout próprio): Pix ou cartão (o número vai do navegador direto para a Pagar.me e vira
  token; o sistema nunca vê o cartão). Atende planos (`/c/assinar/<código>`, `/c/pagar/<código>`), horário pago antes
  (`/c/pagar-horario/<id>`: o valor entra sozinho na comanda; cancelado depois de pago vira saldo) e links de
  pagamento (Financeiro → Links: cobrança avulsa ou de comanda aberta, enviada como `/c/link/<código>`; pago, o
  cliente é avisado e o valor entra na comanda). Limite de tentativas de cartão por hora contra teste de cartões.
- **Maquininha**: `MAQUININHA` = `manual`, `simulada` ou `stone` (Stone Connect 2.0 pela API da Pagar.me).
- **Financeiro** (`/financeiro`): caixa (fundo de troco, sangria, suprimento, fechamento com contagem, extrato do
  turno), despesas (paga com dinheiro do caixa vira sangria; recorrente cria a do mês seguinte), links de pagamento,
  estornos, conciliação por dia e meio (bruto, taxa, líquido esperado e data prevista contra o que caiu; o dono
  configura taxas e prazos de cada meio; dinheiro é conferido no caixa) e resumo do mês (dono: receitas, despesas
  pagas e resultado contra o mês anterior, sem contar nada duas vezes — pago antes e links entram na data do
  pagamento, estorno desconta na data em que foi feito). O caixa esperado em dinheiro sai dos pagamentos das
  comandas feitos com o caixa aberto.
- **Conciliação Celcash + Stone** (`src/lib/conciliacao/`): extrato da Celcash sincronizado pela API (só leitura;
  histórico inteiro pelo painel, últimos dias pela rotina); extrato da Stone por upload do CSV. Cada movimento é
  classificado (recebimento, taxa, antecipação, estorno, transferência entre contas próprias, pagamento, tarifa) e
  guardado uma vez. **Regras por nome** (`RegraConciliacao`) classificam saídas pelo texto do nome da contraparte,
  para Celcash e Stone; classificação feita à mão não é sobrescrita. Tela "Resultado do mês": faturamento
  registrado × o que caiu, taxas, saídas por categoria, retiradas e lucro, com divergências marcadas.
- **Estornos**: a recepção pede (comanda, horário pago antes, link ou mensalidade, inteiro ou parcial); o pedido
  fica pendente, o dono é avisado no WhatsApp, vê um contador no menu Financeiro e aprova, recusa ou estorna direto. Devolve pelo meio certo (Pagar.me, Stone Connect, dinheiro como
  sangria, ou "por fora"). Se o meio recusar, fica como falhou e nada muda.
- **Automações** (Configurações → Mensagens automáticas no WhatsApp; rodam a cada 5 min, nada sai duas vezes,
  histórico na mesma tela): lembrete na véspera (24 h antes, ajustável; pede *SIM*, o bot confirma ou oferece
  remarcar), lembrete chegando a hora (90 min, ajustável, com endereço), depois da falta (se não remarcou), limite
  de faltas (2 em 60 dias, ajustável: o cliente só marca falando com a equipe), agradecimento com link de avaliação
  no Google (desligado por padrão), chamar de volta quem sumiu (desligado por padrão; até 15 por rodada), parabéns
  no aniversário (precisa da data de nascimento). Tudo entre 8h e 21h (menos o lembrete de última hora); quem
  responde **PARAR** não recebe mais nada automático. Fora da janela de 24 h do WhatsApp oficial usa o modelo
  `WHATSAPP_TEMPLATE_AVISO`.
- **Crescimento**: lista de espera de horário (site "Me avise se abrir horário" com período do dia, ou bot; a cada
  5 min confere; com 1 vaga avisa o primeiro e, se em 20 min ninguém pegar, o próximo; quem marcou sozinho sai; dia
  passado expira). Hora de voltar (ritmo médio das últimas visitas, de 7 a 60 dias; um dia antes manda 2 horários
  livres do barbeiro de costume; pula quem tem horário, está na espera ou ainda não pode usar o plano). Indique e
  ganhe (`/i/<código>` ou código no WhatsApp; boas-vindas para o novo, prêmio para quem indicou no 1º corte; só
  cliente novo, uma vez, ninguém indica a si mesmo; descontos voltam se a comanda for cancelada). Saldo
  (`/c/saldo`: cashback, prêmios e indicações não vencidos, com extrato; usa primeiro o que vence antes) e cashback
  (% e validade definidos pelo dono; comanda cancelada anula).
- **Campanhas WhatsApp** (`/campanhas`, dono e gerente):
  - Capacidade da agenda em 3, 7 e 14 dias por barbeiro (expediente menos folgas, agenda fechada e marcados, a
    partir da antecedência mínima), horários ociosos e "capacidade para ~X novos agendamentos" (vaga do tamanho do
    serviço que mais sai, com a duração de cada barbeiro e o intervalo).
  - Segmentos com tamanho: 0–30, 31–60, 61–90, 91–180, +180 dias, assinantes, ex-assinantes, perdidos (+90 dias),
    novos (1ª visita em 30 dias) e cadastrados que nunca vieram; mostra quantos podem receber agora.
  - Campanha = segmentos + mensagem (`{nome}`, `{barbearia}`, `{link}`; o "responda PARAR" entra sozinho) + limite
    por dia. O dono libera lotes; o tamanho sugerido vem da agenda livre em 7 dias e da taxa de quem costuma marcar
    (ex.: 40 vagas ÷ 20% = 200). Mais recentes primeiro; até 20 a cada 5 min, 8h–21h; quem marcou ou pediu PARAR
    depois do lote é pulado. A primeira sugerida é só para quem veio nos últimos 60 dias. Pausar segura a fila;
    encerrar cancela quem não recebeu.
  - Link rastreado `/c/r/<código>` (sem login): abre a agenda ou, na campanha de jogo, dá 1 jogada de presente
    (prêmio no número do cliente) e depois "Agendar e usar meu prêmio".
  - Funil: enviadas → entregues → lidas → abriram o link → jogaram → ganharam → abriram o app → têm conta →
    agendaram (até 14 dias) → compareceram → resgataram, com % e o faturado. Clique só conta em navegador (robô de
    prévia não); entregue/lida vêm da API oficial ou da Evolution (o simulador não informa).
- **Jogos de recompensa** (`src/lib/jogos/`, `/jogos`, `/c/jogos`): Roleta Black, Caixas-surpresa e Raspadinha num
  motor único. Jogadas vêm de atendimento, grátis periódico, campanha, indicação, aniversário, assinatura ou manual.
  Prêmios: crédito (vira saldo), brinde, serviço, desconto ou nada, com raridade, chance, estoque, limite mensal,
  custo e validade. O sorteio é feito no servidor; a tela só anima. Recepção confere o código e entrega no balcão
  (fica registrado quem entregou). Custo × faturamento (dono): custo = custo interno dos brindes entregues + saldo
  de prêmio usado; faturamento = o pago nas visitas em que o cliente usou um prêmio; mostra retorno por real e saldo
  ainda não usado. Antifraude: um cliente por telefone, um ID por prêmio, validade e situação, não entrega duas vezes.
- **Checklist** (`/checklist`, dono e recepção): tarefas por função (diarista, barbeiro, gerente) e dia da semana;
  de manhã cada pessoa recebe a lista no WhatsApp com link sem login (`/t/<código>`), à noite sai o resumo das
  pendências. O gerente valida (ganha pontos) ou dá "re" (marcou sem fazer: perde pontos e a tarefa volta). Faixas
  BLACK ELITE, BLACK PLATINA e BLACK LEGEND, com classificação. Só o dono muda os pontos das faixas, e antes de salvar
  vê quem sobe ou desce. Pontos de um mês com bônus ou folha fechados não mudam: a correção é um ajuste de pontos.
- **RH** (`/rh`):
  - Funcionários (mesmo cadastro do checklist).
  - Comissão de avulsos: % ou fixo por serviço, exceção por barbeiro, sobre o valor efetivamente cobrado (desconto
    da comanda, inclusive saldo, e estornos saem na proporção; produtos não entram). Sugestão inicial: avulso 40% e
    plano R$ 15,00 por corte.
  - Comissão das assinaturas (o "pote" do CashBarber; ligada, substitui a regra de plano por serviço): Receita de
    Assinaturas (mensalidades pagas) − estornos = Receita Distribuível (taxas ficam com a barbearia); valor do
    crédito = Receita Distribuível ÷ Créditos de Atendimento de todos; comissão = créditos do barbeiro × valor do
    crédito × % base.
  - Comissão diferenciada: pontos a mais por barbeiro, separados para assinaturas e avulsos, pagos pela barbearia,
    com motivo, autor, início e fim; o que valeu não se apaga (encerra com data); mês com folha fechada só muda após
    reabrir; tudo auditado.
  - Comissão de produtos por faixa de venda, separada para loja e bar.
  - Relatório por período (créditos, receita atribuída, % base e adicional, comissões; num mês inteiro também
    salário, bônus, descontos e total) e folha mensal (prévia, lançamentos — vale pode sair do caixa como sangria —,
    fechar, marcar paga como despesa, reabrir, exportar CSV).
- **Indicadores** (`/indicadores`): período de 7/30/90 dias, mês, mês passado ou ano, comparado ao anterior do
  mesmo tamanho. Faturamento por fonte, gasto médio, ticket, ocupação (geral, por dia, dia da semana e barbeiro),
  faltas, novos, frequência, retorno de novos, base ativa/sumindo/perdida, idade, como conheceram, quem mais gastou,
  assinaturas (MRR, churn, LTV, uso do plano, custo de cada corte do plano, motivos de cancelamento), bar e loja
  (ticket, margem, mais vendidos) e canais de agendamento, com leituras automáticas no topo. Detalhe por barbeiro
  em `/indicadores/barbeiro/<id>`; o barbeiro vê só os dele. Idade e "como conheceu" vêm do perfil, do cartão do
  atendimento ou do bot após o primeiro agendamento.
- **Auditoria** (`/auditoria`, dono): quem mudou o quê, quando, IP e aparelho, com antes → depois.
- **Backups e homologação**: ver [Operação](docs/architecture.md#operação).

## Fora de escopo

Itens pendentes ou adiados ficam em [docs/pendencias.md](docs/pendencias.md): LGPD (termos, consentimento,
exclusão/exportação), conclusão da migração do CashBarber, testes reais de cartão na Pagar.me, decisão WhatsApp
oficial × Evolution, CRM de prospecção, loja no app, foto do cliente, analytics do produto,
monitor de saúde, white-label, agentes de IA e o financeiro pessoal do barbeiro (produto separado).

## Requisitos (regras garantidas pelo sistema)

- Dois atendimentos do mesmo barbeiro nunca se sobrepõem: restrição `EXCLUDE` no Postgres e trava por barbeiro.
- Atendimento só dentro do expediente do dia e fora de períodos fechados.
- Cliente (bot e site): antecedência mínima, até N dias à frente, no máximo 2 horários futuros, sem dois horários
  no mesmo período, e só altera/cancela até 2h antes (configurável na tabela `configuracao`).
- Barbeiro só altera a própria agenda; recepção mexe em atendimentos, não em expediente; cliente só vê e altera os
  próprios horários.
- Senhas com scrypt; login errado não revela se a conta existe. O sistema nunca vê o número do cartão.
- Estorno nunca passa do valor pago; quem aprova é o dono (ou quem a matriz autorizar).
- Webhook do WhatsApp oficial só aceita chamadas assinadas pela Meta e ignora mensagens repetidas.
- Toda alteração relevante vai para a tabela `auditoria`; o banco recusa alterar ou apagar esse registro.
- Homologação (`AMBIENTE=homologacao`) força WhatsApp, pagamentos e maquininha simulados.
- Idioma pt-BR; fuso da barbearia em `TZ_BARBEARIA`. Painel funciona em celular (barra inferior) e desktop
  (menu lateral); área do cliente pensada para celular.

## Restrições e decisões técnicas

Next.js 16.3.7 (App Router), React 19.2.8, TypeScript, Prisma 6.19 + PostgreSQL 16, Tailwind 4, Vitest, Zod,
jose (sessão JWT), date-fns. Servidor Node sempre ligado (tempo real por SSE e rotinas rodam no processo); não usar
hospedagem serverless. Detalhes em [docs/architecture.md](docs/architecture.md).

### Exceções de stack

- **ORM**: o padrão do toolkit para persistência nova é Drizzle ORM. Este projeto usa **Prisma + PostgreSQL** desde
  a primeira migração (`prisma/migrations/`, schema em `prisma/schema.prisma`) e **continua em
  Prisma**: não há migração para Drizzle planejada. Código novo usa o cliente `db` de `@/lib/db`.

## Hipóteses e pendências

Ver [docs/pendencias.md](docs/pendencias.md) (fases A a D, com o que existe e o que falta, e itens que dependem de
ação do dono marcados com 👤).

## Critérios de aceitação

Cada área tem um teste de fluxo de ponta a ponta contra o banco de desenvolvimento, com gateways falsos
(`npm run teste:<área>`), e o CI exige todos passando (`npm run teste:todos`). Ver
[docs/onboarding.md](docs/onboarding.md#verificar).

## Próxima entrega

Definida em [docs/pendencias.md](docs/pendencias.md), seção "Fase A: lançamento" (migração CashBarber validada,
conciliação completa CashBarber + Celcash + Stone, testes de cartão e decisão sobre o WhatsApp).

## Manutenção

Atualize este documento quando objetivo, escopo, restrições ou critérios de aceitação mudarem. Decisões técnicas e
operação ficam em docs/architecture.md; setup em docs/setup.md.
