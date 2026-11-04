# Atendimento após o piloto de entrevistas

Esta alteração prepara atendimento separado dos envios do piloto, sem ativar o canal nem alterar os valores de produção. Enquanto `WHATSAPP_PILOTO_ENTREVISTAS_HABILITADO=true`, o envio de mensagens comuns, templates, campanhas e rotinas continua bloqueado.

Com essa chave mantida, o atendimento de conversas só passa pelo bloqueio se `WHATSAPP_ATENDIMENTO_APOS_PILOTO=true` **e** houver registro de piloto expressamente encerrado (`ativo=false`). Piloto ativo, expirado mas não encerrado ou sem registro não permite a reabertura. O envio permitido é apenas resposta manual da equipe ou mensagem de retorno originada pelo processador de atendimento; não libera origem genérica, sistema, campanha ou entrevista.

O encaminhamento automático continua sujeito à configuração `botAtivo`. Sem a chave `WHATSAPP_ATENDIMENTO_IA_PAGA=true`, ele faz apenas uma saudação com link ao app e encaminha para a equipe, sem modelo Anthropic e sem executar suas ferramentas. Ativar IA paga é uma ação separada e requer verificar custos e autorização. Mesmo com atendimento liberado, os comandos e sessões de entrevista ficam isolados.

Antes de testar ou ativar, conferir a versão implantada, estado real do piloto e da conexão, mensagens pendentes, configuração do bot, custos e políticas do canal, e usar testes com provedor simulado. A mudança dessas chaves em produção e o reenvio de mensagens não fazem parte desta implementação. Uma reserva verificada no banco antes do transporte não é confirmação de entrega; em caso de falha, consultar estado e evitar reenvio em duplicidade.
