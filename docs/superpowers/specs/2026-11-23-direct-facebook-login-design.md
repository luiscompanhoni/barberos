# Direct do Leonel com login do Facebook

O app Black Barber Direct usa o login unificado da Meta. O BarberOS passa a enviar pelo Messenger Platform para Instagram usando a página vinculada. A caixa de Conversas, o atendimento e a persistência continuam compartilhados pelos dois modos.

## Decisão

Manter uma seleção de configuração no ponto de envio. A troca integral eliminaria a opção de usar uma instalação já configurada com Instagram Login. O envio usa `facebook_login` por padrão e aceita `instagram_login` quando configurado explicitamente. Um valor desconhecido impede envio real. Cada modo usa suas próprias credenciais, sem fallback entre tokens.

O modo Facebook usa `POST https://graph.facebook.com/{versão}/{PAGE_ID}/messages` com Page access token e `recipient.id` igual ao IGSID. Adotar `v26.0` como padrão do Facebook, a versão mais recente com lançamento datado na tabela oficial consultada para 23/11/2026. A versão continua configurável. O modo Instagram mantém host, ID profissional, token e versão explícita. A confirmação, a simulação e a janela de 24 horas são compartilhadas. [Send API](https://developers.facebook.com/documentation/business-messaging/instagram-messaging/features/send-message) · [Calendário de versões](https://developers.facebook.com/docs/graph-api/changelog/versions/)

O callback `instagram` mantém o ID profissional em `entry.id` e `recipient.id`. A página serve para autorizar e enviar. O webhook mantém verificação, HMAC, descarte de ecos e gravação única por `mid`. A inscrição da página e a assinatura do objeto `instagram` são operações distintas na Meta. [Webhooks de mensagens do Instagram](https://developers.facebook.com/documentation/business-messaging/instagram-messaging/webhooks) · [Inscrição da página](https://developers.facebook.com/docs/graph-api/webhooks/getting-started/webhooks-for-instagram/)

## Restrições e aceite

- Trabalhar na worktree e branch `crescimento/dezembro-20261122`. Commits locais em pt-BR.
- Usar só fixtures, serviços locais e PostgreSQL de teste. Preservar `WHATSAPP_ENVIOS_BLOQUEADOS=true` durante toda a execução. Sem envio externo, IA paga, alteração na Meta, deploy, push ou alteração em produção.
- Ausência de `INSTAGRAM_ENVIOS_BLOQUEADOS` e `AMBIENTE=homologacao` simulam. A quarentena mantém a proteção. IA paga exige a liberação explícita já existente.
- Cobrir ambos os transportes, desafio, HMAC, conta errada, ecos e concorrência por `mid`. Validar Conversas no Vercel agent-browser, executar os checks e registrar os resultados e as etapas na Meta.
