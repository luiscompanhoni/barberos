# Metas de crescimento até 31/12/2026

O módulo puro `src/lib/crescimento/metas.ts` calcula cenários revisáveis. Ele não consulta produção, não altera assinatura, não aprova orçamento e não envia campanhas.

## Metas e unidades

- 400 clientes distintos com contrato adimplente vigente em 31/12/2026.
- Receita reconhecida líquida de dezembro de R$ 70.000,00 (7.000.000 centavos).
- Margem líquida de 35% (3.500 pontos-base), lucro de R$ 24.500,00 e custos totais de até R$ 45.500,00.

Dinheiro e contagens entram como inteiros não negativos seguros. Valores negativos, fracionários ou fora da precisão segura causam `RangeError`. Um prejuízo calculado pode ser negativo. Somatórios e proporções usam `BigInt` internamente e devolvem números seguros; não há `BigInt` na API de saída. Projeções monetárias são truncadas para baixo por contrato; a reserva de margem por novo cliente é arredondada para cima.

Os números 271/38/R$ 34.298 são fotografia nominal, sem conciliação de competência e custos. Os preços de vitrine de R$ 118/98/178 não substituem o valor líquido de cada contrato. Nenhum desses números é padrão do calculador.

## Entradas e fonte responsável

`EntradaMetasCrescimento` exige que o chamador forneça:

| Campo | Significado |
|---|---|
| `referencia` e `fuso` | Data civil `YYYY-MM-DD`, ou um `Date` convertido no fuso informado. O padrão é `America/Sao_Paulo`. Não há relógio implícito. |
| `realizado` | Período de competência com início incluso/fim exclusivo, receitas líquidas de assinaturas e outras vendas, metadado dos descontos/estornos já deduzidos e custos completos do mesmo período. |
| Contagens e `contratos` | Clientes adimplentes/atrasados na referência, contratos com ID, cliente, plano, valor mensal líquido vigente e datas civis. `contratosCompletos` declara cobertura. |
| `cancelamentos` | Contrato e data civil em que a cobertura termina. O menor fim entre contrato e cancelamento prevalece. Cancelamento não retira retroativamente receita de dias cobertos. |
| `dezembro` | Previsão explícita de outras vendas líquidas e todos os custos-base de dezembro, excluindo somente os custos adicionais dos novos ainda necessários. Incluir equipe, fixos, variáveis da base, tributos, taxas, pró-labore e demais despesas da competência; caixa de empréstimo não é receita. |
| `aquisicao` | Receita líquida **de dezembro** por novo necessário, custos variáveis adicionais e indicação, com contribuição verificada antes de habilitar teto candidato. Não inserir mensalidade cheia se haverá cobertura parcial. |
| `capacidade` | Duração real da visita, minutos de escala ofertáveis de dezembro já líquidos de pausas/bloqueios, demanda de outras vendas e cenário escolhido de 2, 3 ou 4 visitas. |

Dados nulos declaram informação ausente. Zero só deve ser informado quando verificado. Não marcar `custosCompletos`, `contratosCompletos`, `contribuicaoVerificada` ou capacidade `verificada` para contornar um bloqueio. A API não audita a fonte desses dados; quem carrega a interface precisa preservar origem, cobertura e data da consulta.

Um cliente pode renovar com contratos sucessivos sem virar novo cliente. Contagens são por `clienteId`; sobreposição de períodos contratuais do mesmo cliente bloqueia o orçamento e precisa de revisão. O estado `ADIMPLENTE` projetado é hipótese de continuidade do pagamento, não confirmação de cobrança futura. Atrasados ficam separados e não compõem a receita contratual projetada.

## Cálculos e interpretação

`projetarReceitaContratoDezembro` usa a interseção de cobertura do contrato com `[2026-12-01, 2027-01-01)`, dividida por 31. Por exemplo, início em 16/12 cobre 16 dias; fim exclusivo em 16/12 cobre 15 dias. Reutiliza as regras de datas da agenda, sem dividir instantes por uma duração presumida de dia local. O resultado é projeção por competência civil, nunca liquidação ou cobrança. Se a política contábil contratual real usar outro reconhecimento, o cenário precisa ser reconciliado antes de uso.

`calcularMetasCrescimento` separa receita e margem realizadas do cenário de dezembro. MRR nominal/adimplente é apenas referência mensal dos contratos ativos; não é somado ao realizado nem usado como receita de dezembro. Descontos e estornos já deduzidos são metadados: o calculador não os subtrai outra vez.

A quantidade de novos necessários é `max(0, 400 − clientes adimplentes cobertos em 31/12)`. Os contratos fornecidos já incluem suas datas de início/fim, inclusive futuros conhecidos. A receita por novo ainda faltante precisa ter sido proporcionalizada pela cobertura esperada de dezembro, com desconto/estorno líquido, pelo responsável pela simulação. Sem essa estimativa e a contribuição verificada, o orçamento fica bloqueado; não se presume que bater 400 em 31/12 gere 400 mensalidades em dezembro.

A saída informa as outras vendas necessárias para completar R$ 70 mil depois dos contratos e dos novos, a previsão de outras vendas e a diferença ainda descoberta (`bridgeOutrasVendasCentavos`). Um bridge positivo bloqueia o teto candidato. A simulação não inventa ticket, conversão, visitas avulsas nem retorno espontâneo para fechar a conta.

`cenariosCapacidade` calcula 2/3/4 visitas por cliente usando pelo menos 400 clientes, ou a projeção maior. Acrescenta os minutos de outras vendas e compara com 85% dos minutos reais ofertáveis. Entrega minutos e horas; não presume jornada de oito horas, profissionais, duração padrão ou disponibilidade de agenda. O cenário escolhido precisa ser viável. Essa soma mensal não garante encaixe por profissional/dia/serviço: a distribuição operacional continua sendo conferência necessária antes da execução.

## Indicação, contribuição e orçamento

Os campos da aquisição descrevem somente os clientes ainda faltantes, sem repetir os novos já incluídos nos contratos. Receita e custos devem usar a mesma janela de dezembro. Se a indicação custar R$ 30 e R$ 10 do desconto ao indicado já tiverem reduzido a receita informada, registrar custo total de 3.000 centavos e crédito já deduzido de 1.000; somente os 2.000 restantes entram como custo adicional. Esse crédito não pode exceder o custo total. Crédito emitido, mas ainda não consumido, não é receita nem pagamento; um cenário conservador deve incluir seu custo esperado uma única vez.

Contribuição por novo = receita líquida por novo de dezembro − custos variáveis adicionais − indicação ainda não deduzida. O limite unitário de CAC preserva 35% dessa receita. O teto agregado é o menor entre esse limite vezes os novos necessários e a folga dos custos completos do cenário. A folga respeita tanto 65% da receita projetada quanto o teto conservador absoluto de R$ 45.500,00. Não usa LTV, caixa, MRR ou lucro futuro não demonstrado para financiar aquisição.

`cacMaximoCandidatoCentavos` é o teto agregado dividido pelos novos, truncado. O teto é zero quando a meta já está coberta. O cálculo bloqueia valores candidatos com custos incompletos, receita descoberta, divergências de contratos, contribuição não verificada/insuficiente, capacidade desconhecida/insuficiente, prazo encerrado ou períodos realizados não encerrados. `bloqueios` traz os motivos legíveis como códigos. Custos incompletos ou receita zero também impedem declarar margem realizada. A margem do cenário fica nula se os custos de dezembro estiverem incompletos.

`orcamentoAprovado` é sempre `false`, mesmo sem bloqueios. O teto candidato é referência matemática para revisão, sem autorizar gasto, desconto ou contato. A margem/lucro de dezembro apresentados antecedem o CAC candidato; aprovar e executar esse gasto exige atualizar a simulação dos custos. O teto já preserva a meta após o gasto, sujeito às premissas fornecidas.

## Verificação

`tests/crescimento-metas.test.ts` cobre competência versus MRR/realizado, custos incompletos/nulos, receita zero, prejuízo, datas e 31 dias, atraso/cancelamento, fuso civil, indicação de R$ 30 sem dupla subtração, bloqueios de orçamento, capacidade com 15% de folga, negativos e overflow. Nenhum teste usa banco ou provedor externo.

## Painel e API de consulta

`/crescimento` apresenta a fotografia local e um formulário de hipóteses financeiras/capacidade. Página e `GET`/`POST /api/crescimento/metas` exigem sessão de liderança e a permissão financeira `lucro`. Respostas não usam cache. Não há escrita no banco, sincronização de gateway, envio de campanha ou custo de API.

O GET lê contratos não cancelados com o preço travado na adesão, agrupados por plano e valor. Distingue clientes nominais, adimplentes comprovados localmente, atrasados e outros sem comprovação. `ATIVA` isoladamente não comprova adimplência. Exige ciclo mensal ainda vigente, próximo vencimento futuro, ausência de pausa/operação inicial/encerramento e uma cobrança PAGA do mesmo dia civil do ciclo, com `pagaEm` não futuro e sem vínculo com cobrança histórica externa. O dia do ciclo segue a data de vencimento gravada pelas regras existentes de cobrança, em vez de deslocar essa data UTC para a véspera no fuso local.

Essa comprovação descreve registros locais; eventos de gateway, importações e liquidação ainda não foram auditados. Datas e valores contratuais são hipóteses de continuidade em dezembro. O GET não calcula DRE nem chama o financeiro para inventar receitas reconhecidas ou custos completos. Sem banco acessível, retorna erro 503 claro e nenhum dado fictício. Não retorna nomes, telefones, CPF, tokens, IDs originais de clientes/contratos ou links de pagamento: vínculos usam identificadores pseudônimos por resposta.

O formulário permite informar receitas líquidas de um período fechado, custos completos, outras vendas esperadas, economia da aquisição e capacidade real. Contratos sem prova ficam fora da projeção e impedem marcar cobertura completa. Classificação, valor e cancelamentos dos contratos vêm da base; o formulário não os altera. Para revisar esses dados, conferir a gestão de assinaturas e atualizar a consulta. O POST também aceita contratos/cancelamentos explícitos para um cenário revisável, valida toda a estrutura com Zod e rejeita campos adicionais como aprovação injetada.

`tests/crescimento-metas-api.test.ts` verifica os dois controles de acesso, evidência do ciclo atual, atraso/pausa/operação inicial, vencimento artificialmente empurrado, pagamentos futuros, pseudonimização, indisponibilidade sem vazamento de credenciais, erros de entrada e ausência de consultas de negócio no POST. Os testes usam banco falso; não comprovam qualidade dos dados locais ou comportamento publicado.
