# Migração Celcoin/Celcash → Pagar.me — novembro de 2026

**Decisão de Ygor em 08/11/2026:** concluir a migração até **20/11/2026**, admitindo extensão para pendências. A comunicação pode priorizar essa meta real; não deve afirmar cancelamento coletivo ou expiração de link que não foram configurados. Renovação do Cash Barber no dia 20 e troca do provedor de assinatura são eventos diferentes.

## Caminho recomendado

1. Solicitar aos dois provedores confirmação de portabilidade segura dos cartões e elegibilidade da conta. Isso pode evitar recadastro de parte da base.
2. Se a portabilidade não for viável no prazo, usar recadastro pelo titular em página oficial segura vinculada à sua assinatura. Não coletar PAN, CVV, senha ou OTP no WhatsApp. Não transportar token Celcoin como se fosse token Pagar.me.
3. Preservar contrato, valor acordado, serviços, vencimento, período já pago e benefícios de cada assinante. O preço atual do catálogo não substitui automaticamente o contrato antigo.
4. Orquestrar uma assinatura por vez. Recapturar o meio de pagamento não significa necessariamente cobrar naquele momento. Antes de usar checkout que gera débito imediato, conferir o ciclo já pago e a capacidade da Pagar.me de iniciar a recorrência na data correta.
5. Concluir apenas após prova do vínculo novo, aceite aplicável e confirmação de que o legado não fará a próxima cobrança. Sem prova de um desses passos, manter exceção para o gerente; não repetir pagamento nem recriar contrato às cegas.

A documentação de [migração de cartões Pagar.me v3](https://docs.pagar.me/v3/docs/fluxo-de-migra%C3%A7%C3%A3o-de-cart%C3%B5es) descreve fluxo seguro entre provedores PCI. É documentação legada e **não comprova que Celcoin → conta Pagar.me atual esteja disponível**. A [migração automática para v5](https://docs.pagar.me/page/solu%C3%A7%C3%A3o-de-migra%C3%A7%C3%A3o-autom%C3%A1tica-de-cart%C3%B5es) trata de cartões de versões anteriores da própria Pagar.me; não resolve essa compatibilidade por si só. A troca de cartão também não transfere contrato, histórico ou calendário automaticamente.

## Quadro por assinatura

Usar os IDs dos sistemas e uma chave única de migração por contrato. Planilha/quadro compartilhável não deve conter cartão, documento, telefone ou link individual.

| Estado | Evidência para entrar | Próxima ação |
|---|---|---|
| A conferir | Contrato legado identificado, sem decisão de rota. | Conciliar titular, plano, valor, vencimento e pagamento do ciclo. |
| Pronto para convite | Rota e página oficiais testadas, sem conflito de cobrança. | Gerar convite individual com validade real. |
| Convidado | Provedor aceitou a mensagem. | Aguardar eventos de entrega/resposta; aceite não prova leitura. |
| Iniciou | Evento da página autenticada. | Ajudar somente no passo pendente. |
| Cartão confirmado | Confirmação do provedor, vinculada ao contrato e titular. | Conferir próxima cobrança e transição da origem. |
| Legado conciliado | Próxima recorrência antiga interrompida de forma verificável, preservando período pago. | Conferir uma única próxima cobrança válida. |
| Concluído | Vínculos, aceite, datas e exclusividade de cobrança conferidos. | Parar todos os lembretes e confirmar ao cliente. |
| Precisa de ajuda / ligar | Falha, pedido de pessoa ou ausência de avanço após a cadência. | Gerente assume com resumo; bot para os convites. |
| Não contatar / adiado | Recusa ou extensão combinada com responsável/data. | Suprimir mensagens; revisão na data combinada quando cabível. |

Ausência de leitura não comprova que a pessoa ignorou. Clique não comprova cadastro; cadastro não comprova cartão; cartão não comprova transição concluída. Webhooks podem repetir: processar por ID e estado, com bloqueio por contrato. Tempo esgotado com efeito externo desconhecido exige conferência, não repetição automática.

## Cadência proposta, pronta para parametrização

**Ainda não está rodando no bot:** falta confirmar rota do provedor, página de recadastro e eventos do processo. Não usar o fluxo de nova venda como migração improvisada.

| Momento | Condição | Mensagem/ação |
|---|---|---|
| D0 | Contrato conferido, contato permitido e canal/template disponíveis. | Convite individual com identificação clara da Black e meta de 20/11. |
| D+2 | Não concluiu e não há resposta/atendimento em andamento. | Um lembrete curto. Se iniciou, oferecer ajuda no passo observado. |
| D+5 | Sem avanço e sem recusa. | Perguntar se prefere ajuda por aqui ou uma ligação; abrir fila para a equipe. |
| 19/11 | Ainda pendente, sem intervenção humana e pelo menos 48h desde o último lembrete. | Reforçar a meta real e oferecer ajuda. Se entrou tarde, não comprimir todos os contatos. |
| 20/11 | Revisão humana das exceções. | Concluir o que tem prova; definir extensão para cada pendência e responsável. |

Limite proposto: **até quatro mensagens automáticas por cliente nesse período**, no máximo uma a cada 48 horas, contando a cadência global. Em vez de repetir a pergunta constantemente, mudar a ajuda conforme a etapa. Parar ao concluir, pedir para parar, entrar em atendimento humano, reclamar ou combinar adiamento. Não incluir simultaneamente o mesmo cliente na campanha de reativação.

Fila de ligação: telefone válido disponível somente no ambiente autorizado, motivo, contrato, último evento e ação necessária. Uma tentativa da equipe em horário apropriado; reagendar quando solicitado. Não criar ligações automáticas com voz clonada nesta fase. Sem contato, registrar “não localizado”, nunca “migrado”.

## Mensagens prontas

Texto é modelo de revisão. Substituir `{link_seguro}` somente por link oficial real; fora da janela de atendimento, usar o template aprovado para a finalidade. A [política do WhatsApp](https://whatsappbusiness.com/policy/) exige identificação correta, permissão e respeito à recusa; cadastro antigo e `aceitaMensagens=true` isoladamente não comprovam opt-in.

**Convite:**

> Fala, {nome}! Aqui é da Black Barber. Estamos mudando o sistema que cuida da sua assinatura e nossa meta é concluir até 20/11. Para continuar a cobrança no novo sistema, você precisa confirmar o cartão na página segura: {link_seguro}. Quer ajuda por aqui? Não precisa mandar os dados do cartão no WhatsApp.

Usar a frase sobre manter valor/vencimento somente se o contrato daquele cliente tiver sido conciliado. Se for portabilidade sem ação do cliente, não enviar um pedido desnecessário de recadastro.

**Lembrete:**

> Oi, {nome}! A confirmação da sua assinatura no sistema novo ainda aparece pendente. Conseguiu abrir a página ou travou em alguma etapa?

**Pedido de ajuda/ligação:**

> {nome}, quer que a equipe te ajude a concluir a mudança? Pode ser por aqui ou por uma ligação, como ficar melhor pra você.

**Véspera:**

> {nome}, nossa meta é concluir a mudança amanhã, 20/11. A sua ainda está pendente. Se precisar de mais tempo ou ajuda, me avisa para a equipe acompanhar contigo.

**Conclusão, somente com prova:**

> Tudo certo, {nome}! A migração da sua assinatura foi concluída. {resumo_confirmado_do_proximo_vencimento}. Você não precisa repetir o cadastro.

**Transferência interna:**

> Motivo: migração da assinatura. Etapa: {estado}. Confirmado: {dados_verificados}. Pendente: {acao}. Último contato: {data}. Não fazer nova cobrança até conciliar o ciclo atual.

## Sequência até 20/11

- **08–10/11:** inventário, conciliação e confirmação técnica com provedores. Validar página segura, vínculo, primeira cobrança, cancelamento da recorrência antiga e retorno de erro com casos internos.
- **11–13/11, se os testes passarem:** pequeno lote acompanhado pelo gerente. Conferir casos com vencimentos antes e depois do dia 20 e clientes com ciclo já pago.
- **14–19/11:** ampliar somente conforme capacidade de conferência; cadência acima, fila de ajuda e contatos não localizados.
- **20/11:** fechar concluídos e exceções. Só encerrar o serviço antigo após preservar agenda, contratos, exportação e acesso necessário. Se a base não estiver pronta, comparar o custo do mês adicional com o risco e a receita preservada.

As datas intermediárias são proposta operacional, não execução concluída. Definir hora da virada, responsável e reversão antes de qualquer corte.

## Conferência diária e reversão

Mostrar por estado: contratos totais elegíveis, convidados, iniciados, cartão confirmado, concluídos, falhas, ajuda, não localizados, recusas e adiados. Cobertura = concluídos / contratos elegíveis conciliados. Separar valores por ciclo e provedor; não somar fatura emitida com recebimento.

Se houver cobrança dupla, troca de titular, valor ou ciclo incorretos: parar o lote e os lembretes daquele contrato, conferir os dois provedores e encaminhar ao gerente. Preservar o benefício já pago. Reembolso exige ação da gerência. Não apagar a origem nem reativar cobranças em massa como reversão. Manter exportações e vínculos auditáveis até a conciliação final.
