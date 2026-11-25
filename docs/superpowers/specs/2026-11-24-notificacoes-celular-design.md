# Notificações no celular

O cliente e a equipe precisam autorizar avisos pelo próprio aplicativo e receber notificações do sistema operacional com o aplicativo fechado. Reutilizar Web Push, VAPID, fila por aparelho e service worker existentes. Um aplicativo nativo separado não é necessário para esse resultado.

## Comportamento

- Convidar a ativar após entrar na conta, somente quando o aparelho oferece suporte e o servidor está configurado. No iPhone, exigir o aplicativo instalado. O botão chama a permissão nativa pelo toque, nunca automaticamente.
- Texto do cliente explica lembretes com serviço, data, horário e barbeiro. Texto da equipe explica os novos agendamentos e dados do atendimento. Esses detalhes podem aparecer na tela bloqueada.
- Respeitar permissão negada, preferências e aparelhos ativos. “Agora não” adia o convite por sete dias nessa conta e aparelho. A central continua permitindo ativar a qualquer momento.
- Barbeiro recebe a própria agenda. Dono e gerente recebem novos agendamentos da barbearia, sem duplicar quando também são o profissional escolhido. A central revalida o papel e o vínculo antes da leitura e do envio.
- Novos agendamentos tentam enviar após confirmar a transação, sem esperar o cron. Lembretes mantêm os intervalos configurados e o cron existente. Push deve funcionar independentemente dos bloqueios de WhatsApp. Quarentena de restauração continua bloqueando tudo.
- Exibir detalhes somente em avisos de agenda e novos agendamentos. Avaliações, cobranças e outros assuntos conservam a mensagem geral. Não incluir CPF, telefone, e-mail ou valores na notificação.
- Cancelamento, remarcação, conta inativa, mudança de vínculo e revogação invalidam eventos antes do envio. Conservar idempotência, limite de tentativas e tratamento de resultado incerto.

## Operação e aceite

Produção está com `PUSH_PROVIDER` desativado e sem VAPID. A mudança de configuração, commit e publicação serão realizados mediante pedido explícito conforme AGENTS.md. Preparar a implementação e provar localmente antes desse passo. Não alterar os horários atuais de lembrete nem ativar campanhas.

Aceite local inclui convite em cliente/equipe, permissão só após toque, detalhes no service worker, destinatários corretos, fila idempotente, cancelamento/remarcação e independência do WhatsApp. Entrega física com app fechado depende da publicação/configuração e de autorização no aparelho.
