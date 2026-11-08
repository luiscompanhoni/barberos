# Rateio das comissões de assinaturas

O dono aprovou em 8/11/2026 distribuir integralmente o pote pelos maiores restos, com desempate fixo e auditável. O percentual do pote, os créditos por serviço e os adicionais continuam sendo regras separadas. A mudança não comprova recebimentos ou produção reais e não efetua pagamentos.

## Política e vigência

`LEGADO` mantém o arredondamento individual anterior. `MAIORES_RESTOS_V1` aplica a distribuição exata do pote base em centavos inteiros. A migração acrescenta a política com padrão `LEGADO`: não ativa a regra nem modifica versões históricas. Versões JSON antigas sem esse campo também continuam legadas.

O dono escolhe a política e a competência no formulário de extras. O salvamento registra revisão e vigência na mesma transação, recusa prévia desatualizada e competência já fechada. Uma competência futura não muda a leitura das anteriores. Retratos fechados ou pagos mantêm seus valores e identidades.

## Pote base

O pote alvo é o percentual configurado sobre a receita distribuível comprovada, arredondado uma vez para centavos. Cada profissional recebe o piso da sua quota proporcional aos créditos elegíveis. Os centavos restantes seguem os maiores restos das quotas; restos iguais usam o identificador da cadeira em ordem lexicográfica crescente, sem depender da ordem dos atendimentos ou da consulta.

Exemplo: um pote de R$ 100,00 para três participações iguais resulta em R$ 33,34, R$ 33,33 e R$ 33,33. O primeiro cadastro na ordem fixa recebe o centavo residual. Sem produção elegível, o dinheiro fica identificado como não rateado; não é distribuído como sobra de arredondamento.

## Adicionais

O adicional é calculado por atendimento, respeitando o limite de 0% a 100%. A média dos pontos contratuais não substitui o efeito dos limites sobre cada atendimento.

A distribuição dos adicionais preserva a parcela de quem não tem ajuste efetivo, o sinal do ajuste e os pisos/tetos das quotas finais. Quando essas condições não admitem uma solução inteira para o total, o recálculo fica em revisão, com motivo e diferença explícitos. A prévia baseada no pote não autoriza absorver diferenças pela casa, descontar outro profissional ou fechar a comissão pendente.

## Fechamento e auditoria

A prévia contém método, critério de desempate, ordem dos cadastros, créditos, numeradores/denominadores exatos, resíduos e comparação dos totais base/final. BigInt é interno; a evidência JSON usa números seguros e strings para as frações exatas. A revisão da apuração inclui a conciliação e o fechamento conserva essa evidência no detalhe.

Produção sem destinatário comprovado aparece como pendência de vínculo, sem associação por nome. O fechamento geral e o CSV incompletos são recusados. Uma ficha individual sem pendência própria, como a recepção, pode ser fechada separadamente. Uma comissão histórica com identidade comprovada permanece vinculada ao retrato mesmo se a ficha atual mudar.

Essa validação não libera Pix, envios, campanhas ou IA paga. A homologação da folha real ainda precisa de recebimentos, produção elegível, comparação por profissional e aprovação final do dono. O tratamento de estorno posterior ao fechamento é uma decisão separada.
