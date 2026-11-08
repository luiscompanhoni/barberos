# Valores, datas e evidência dos gateways

Revisão do contrato em 8/11/2026. Homologação local usa respostas fictícias representativas; não certifica
credenciais, payloads da conta real, taxas contratadas nem liquidação bancária. Nenhuma chamada financeira foi feita.

| Fonte | Cobrado | Pago bruto comprovado | Data utilizada | Casos em conferência |
|---|---|---|---|---|
| Pagar.me | `amount` | `paid_amount` | `paid_at` | valor/data ausentes ou referência divergente |
| Celcash | `Transactions.value` | mesmo campo somente nos substatus normais `captured`, `payedBoleto`, `payedPix` | `paydayDateDateTime` | isenção, externo, menor/maior, duplicado ou data ausente |
| Asaas | `originalValue`, quando informado; senão `value` | `value` em RECEIVED/CONFIRMED | `clientPaymentDate` ou `paymentDate` | dinheiro recebido por fora, valor/data ausentes |
| Simulador | valor fictício | prova marcada `simulado` | data fictícia do pagamento | nunca representa homologação bancária |

O valor pago não é o saldo disponível. No Asaas, CONFIRMED pode anteceder a disponibilidade.
Taxas, antecipações e liquidação permanecem nos extratos. Estornos são registrados em sua execução;
o recebimento original continua na sua data. Não subtrair `canceled_amount` do bruto e novamente o pedido de estorno.
Pagamento parcial ainda pendente pode entrar como recebimento comprovado, mas não entra automaticamente no pote de assinaturas quitadas.

Cada prova guarda fonte, referência, substatus, campos de valor/data, valor e instante. O hash da apuração inclui
o digest da prova; alteração de origem invalida a prévia, mesmo mantendo o mesmo total. A sincronização audita
mudanças da prova e põe os casos não homologados em conferência. Dados antigos não recebem prova por backfill nominal.

Na Celcash, `paydayDate` é vencimento; `statusDate` é mudança de status. A regra antiga relatada pelo dono usava
data de status e o filtro Pago. Esses históricos precisam de ponte auditada e data de corte confirmada; não chamar
uma nova consulta por data efetiva de reprodução exata do método antigo, nem presumir migração automática dos mandatos.
Folhas fechadas continuam congeladas. Um estorno posterior não desconta automaticamente remuneração já fechada.

## Regra confirmada do pote

O percentual base confirmado é 35% para o pote dos barbeiros e 65% para a barbearia. O pote é repartido pela participação de cada profissional nos atendimentos elegíveis do período. Com pesos iguais por serviço, essa participação é a quantidade do profissional dividida pela quantidade total; serviços com créditos diferentes continuam sujeitos à configuração vigente, sem mudar pesos por inferência.

Exemplo hipotético, sem adicional diferenciado ou estorno: se 100 mensalidades de R$ 100 foram efetivamente pagas no período, a base recebida é R$ 10.000 e o pote é R$ 3.500. Em 100 cortes de mesmo peso, profissionais com 35, 25, 20 e 20 cortes recebem R$ 1.225, R$ 875, R$ 700 e R$ 700. Dobrar os cortes de todos preserva as mesmas participações e valores. Um corte representa 1% somente quando há 100 cortes elegíveis de mesmo peso; com 200, representa 0,5%.

Ter 100 assinaturas cadastradas a R$ 100 não comprova o recebimento de R$ 10.000. O cálculo precisa da base de pagamentos comprovados, do período homologado e dos estornos aplicáveis. O esclarecimento não altera folhas fechadas, adicionais aprovados nem define a distribuição de centavos residuais; essas políticas permanecem separadas.

Fontes primárias: [Celcoin — listar transações](https://developers.celcoin.com.br/docs/listar-transa%C3%A7%C3%B5es),
[Pagar.me — cobranças](https://docs.pagar.me/reference/cobran%C3%A7as-1),
[Pagar.me — Pix](https://docs.pagar.me/reference/pix-2),
[Asaas — eventos de pagamento](https://docs.asaas.com/docs/payment-events).
