# Remuneração por competência

Mudanças de salário, regras de comissão e extras precisam de uma competência de início. A prévia deve consultar a última configuração válida até o mês escolhido; propostas futuras não podem substituir o salário vigente nem recalcular meses já fechados.

`RemuneracaoVersao` é um registro de versões acrescentadas, protegido contra atualização, exclusão e truncamento no banco. Cada escopo possui versões por competência. Alterações no mesmo mês acrescentam nova versão, mantendo as anteriores. Repetir o mesmo conteúdo não cria nova versão, inclusive quando a ordem das chaves JSON mudou. O registro e sua auditoria ocorrem na transação da alteração do cadastro ou regra.

No salário, o escopo é `salario:<id-da-pessoa>`. A primeira mudança conserva o valor anteriormente observado como baseline `0001-01`, identificado como `BASELINE_LEGADO_NAO_HOMOLOGADO`. Ele permite distinguir o estado anterior sem afirmar que esse salário foi pago ou aprovado em todos os meses passados. A homologação histórica depende de documentos e conciliação; o baseline não a substitui.

O padrão de uma alteração salarial é o mês seguinte em `America/Sao_Paulo`. O dono seleciona expressamente o mês atual quando quiser aplicação imediata. Competências passadas e competências já fechadas para a pessoa são recusadas nesse formulário. Sem alterar o salário ou escolher outro mês, editar a ficha não cria uma vigência. A tela distingue salário atual de configuração proposta para um mês futuro.

Os helpers `garantirBaselineRemuneracao`, `gravarVigenciaRemuneracao` e `lerVigenciaRemuneracao` não efetuam pagamento. Configurações recebidas pela leitura precisam de validação do domínio; um envelope inválido gera pendência, em vez de assumir zero ou um valor histórico comprovado.

A política de arredondamento das assinaturas também pertence à versão de extras. A migração conserva `LEGADO`; maiores restos exige escolha expressa por competência. Consulte [rateio das assinaturas](rateio-assinaturas.md). A prévia identifica produção sem destinatário e não permite que o fechamento geral ou o CSV a omitam silenciosamente.

O teste `scripts/teste-seguranca-vigencias-estabilizacao.ts` usa somente banco local exclusivo, dados sintéticos e rede bloqueada. A implementação local não aplicou novas remunerações a profissionais reais nem publicou o recurso.
