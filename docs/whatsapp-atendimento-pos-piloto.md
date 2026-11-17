# Atendimento após o piloto de entrevistas

Enquanto `WHATSAPP_PILOTO_ENTREVISTAS_HABILITADO=true`, o envio de mensagens comuns, templates, campanhas e rotinas continua bloqueado por padrão.

Com essa chave mantida, o atendimento de conversas só passa pelo bloqueio se `WHATSAPP_ATENDIMENTO_APOS_PILOTO=true` **e** houver registro de piloto expressamente encerrado (`ativo=false`). Piloto ativo, expirado mas não encerrado ou sem registro não permite a reabertura. O canal permite resposta manual da equipe e mensagem de retorno do processador de atendimento.

Com o atendimento pós-piloto liberado, `WHATSAPP_CAMPANHAS_MANUAIS_ATIVAS=true` libera os controles de campanha do painel. Uma campanha pausada continua pausada. Retomar sem liberar lote mantém a fila vazia, e a rotina só processa destinatários enfileirados em campanhas ativas no horário comercial. As demais rotinas de contato continuam bloqueadas nesse modo. Na API oficial, fora da janela de atendimento, o envio exige um modelo de marketing configurado em `WHATSAPP_TEMPLATE_CAMPANHA`.

O encaminhamento automático continua sujeito à configuração `botAtivo`. Sem a chave `WHATSAPP_ATENDIMENTO_IA_PAGA=true`, ele faz apenas uma saudação com link ao app e encaminha para a equipe, sem modelo Anthropic e sem executar suas ferramentas. Ativar IA paga é uma ação separada e requer verificar custos e autorização. Mesmo com atendimento liberado, os comandos e sessões de entrevista ficam isolados.

Antes de testar ou ativar, conferir a versão implantada, estado real do piloto e da conexão, mensagens pendentes, configuração do bot, custos e políticas do canal, e usar testes com provedor simulado. A mudança dessas chaves em produção e o reenvio de mensagens não fazem parte desta implementação. Uma reserva verificada no banco antes do transporte não é confirmação de entrega; em caso de falha, consultar estado e evitar reenvio em duplicidade.
