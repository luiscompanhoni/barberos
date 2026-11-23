# Dezembro Grátis

A contratação e o cancelamento estão disponíveis em homologação. O cliente entra em `/c/dezembro-gratis` com a própria conta. Dono, gerente e recepção acompanham a oferta em `/assinaturas/dezembro-gratis`. O checkout usa cartões fictícios selecionáveis e o fluxo guarda o contrato e o aceite localmente.

## Configuração de homologação

Use um banco de testes local com as migrações aplicadas. Faça backup antes de usar um banco que já tenha dados. Configure o processo do app com:

| Variável | Valor |
| --- | --- |
| `AMBIENTE` | `homologacao` |
| `OFERTA_DEZEMBRO_MODO` | `homologacao` |
| `OFERTA_DEZEMBRO_PLANO_ID` | ID de um plano-base ativo, comprável, com cartão e serviços ativos |
| `OFERTA_DEZEMBRO_VAGAS` | Número inteiro positivo de adesões para toda a campanha |
| `OFERTA_DEZEMBRO_LIMITE_USOS` | Número inteiro positivo de serviços por adesão, somados entre todos os serviços |

Vagas e usos ficam sem valor padrão. O teto do plano-base também vale. A adesão precisa caber nos dois limites, sob travas transacionais compartilhadas com a venda regular. Em homologação, todas as pendências do plano-base ocupam vaga enquanto o link puder ser pago, inclusive as de mais de três dias. Uma vaga da campanha é consumida por adesão confirmada e permanece ocupada depois de cancelar. A oferta guarda o preço e o limite individual aceitos. Os serviços, profissionais, dias e limites operacionais são os do plano-base.

A adesão abre em 22/11/2026 e encerra em 01/01/2027, às 00h, em America/Sao_Paulo. Entra quem tem cadastro ativo e nenhuma assinatura em andamento. Pendente, ativa, atrasada e pausada impedem adesão. Também impedem a adesão um cancelamento nos últimos 90 dias e adesão anterior à mesma campanha. O prazo de 90 dias considera a hora do cancelamento. Contrato histórico cancelado sem data precisa ter sido criado há mais de 90 dias para seguir.

## Uso e recorrência

- Os horários que começam em dezembro de 2026 podem ser reservados antes do mês grátis. A cobertura aplica-se a horários a partir do instante da adesão. Serviços fora da cobertura ou acima do limite seguem o preço avulso integral. O desconto do plano-base em serviços extras fica desativado para a oferta.
- Reserva, remarcação e adicionais usam a mesma regra de precificação. Cada serviço coberto ocupa um uso. Faltas mantêm o uso ocupado. Horário cancelado libera o uso da assinatura. No cancelamento imediato do contrato, reservas futuras sem comanda passam a avulsas. A comanda já aberta conserva o valor com que foi aberta.
- A primeira competência simulada abre às 00h de 01/01/2027. A fidelidade abrange as seis competências de janeiro a junho. O cronograma segue mensalmente até o cancelamento. A simulação projeta as competências em memória, sem faturas, recebimentos ou cobertura paga após dezembro.
- O cliente pode solicitar o cancelamento imediato ou agendá-lo para 01/07/2027. O cálculo simulado isenta os sete dias contados desde o aceite e, depois, usa o valor de uma mensalidade dispensada multiplicado pela fração de competências de fidelidade ainda incompletas. O arredondamento é para baixo em centavos. Cancelar ao fim da fidelidade fica em R$ 0,00. O sistema registra o pedido sem cobrança de multa.
- O termo versionado registra aceite, data, IP e agente do usuário. Os dados técnicos ficam no registro da adesão e na auditoria e são omitidos da visão de vagas. Revise finalidade, retenção e acesso a esses campos antes de habilitar um caminho real.

## Verificação local

1. Cadastre um cliente fictício sem assinatura e abra `/c/dezembro-gratis` em 390×844. Confira as datas, a mensalidade planejada, o limite e o termo. Confirme com o cartão de teste recusado e confira que nenhuma vaga foi consumida. Depois use o cartão aprovado e confira o contrato registrado.
2. No painel, confira uma adesão e uma vaga consumida. Simule a última vaga com dois clientes distintos e o mesmo titular em duas abas.
3. Em dezembro, escolha serviços cobertos e confira o valor zero até atingir o teto. Com mais itens, confirme que os excedentes mantêm o preço avulso. Em novembro e janeiro, confira o preço avulso.
4. Registre cancelamento imediato ou ao fim da fidelidade e confira o estado e a multa de teste. O cancelamento preserva o consumo da vaga da campanha.

Os testes de regras e precificação rodam com `npm test`. Para executar os testes com PostgreSQL, aponte `DATABASE_URL` para um banco descartável em localhost com `teste` no nome, aplique as migrações e rode `TESTE_OFERTA_DEZEMBRO_LOCAL=1 npm exec -- vitest run tests/oferta-dezembro-banco.test.ts`. O teste cria registros fictícios. Execute em banco dedicado.

## Pendências para produção

- Definir o plano, o limite de vagas e o limite de usos, considerando a capacidade da agenda e o custo dos atendimentos.
- Habilitar credenciais de sandbox da Pagar.me e validar a criação de assinatura com cartão tokenizado e `start_at` futuro. Confirmar no provedor o primeiro débito em 01/01/2027, a ausência de cobrança em dezembro, as seis competências, as falhas de cobrança e o encerramento. A Pagar.me é o caminho das novas recorrências em cartão, Celcash mantém o legado e Stone POS atende cobranças presenciais. [Pagar.me — Criar assinatura avulsa](https://docs.pagar.me/reference/criar-assinatura-avulsa)
- Implementar a integração real após validar o sandbox, com idempotência no provedor, confirmação de pagamentos, conciliação e separação dos contratos de homologação.
- Revisar juridicamente o termo, o direito de arrependimento, a metodologia de proporcionalidade, a base de cálculo e o processo de cancelamento eletrônico antes de aprovar multa ou cobrança. [Código de Defesa do Consumidor, arts. 49 e 51](https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm)
