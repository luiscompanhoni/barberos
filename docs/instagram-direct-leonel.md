# Leonel no Instagram Direct

O Instagram Direct aparece em **Conversas** no painel. O contato inicia a conversa pelo Instagram. Leonel pode consultar serviços, produtos, planos públicos e horários livres. A equipe pode assumir e responder pelo painel dentro de 24 horas da última mensagem do contato. O fluxo encaminha operações da conta ao acesso autenticado do aplicativo.

## Configuração

Use uma conta profissional e escolha **Instagram API with Instagram Login** no App Dashboard. Obtenha um *Instagram User access token* com `instagram_business_basic` e `instagram_business_manage_messages`. Configure o callback HTTPS `https://painel.appblackbarber.com/api/instagram/webhook` e assine o campo `messages`. Habilite a inscrição da conta profissional no mesmo campo, pelo painel ou pelo endpoint `/<IG_ID>/subscribed_apps` em `graph.instagram.com`. [Configuração de webhooks da Meta](https://developers.facebook.com/documentation/instagram-platform/webhooks/setup) · [Permissões e Send API](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api)

| Variável | Uso |
| --- | --- |
| `INSTAGRAM_WEBHOOK_VERIFY_TOKEN` | Token criado para a verificação do callback. Use o mesmo valor no App Dashboard e no servidor. |
| `INSTAGRAM_APP_SECRET` | App Secret da Meta, usado para validar o HMAC SHA-256 dos bytes recebidos. |
| `INSTAGRAM_PROFESSIONAL_ACCOUNT_ID` | ID numérico do perfil profissional conectado. Precisa corresponder ao perfil da inscrição e do token. |
| `INSTAGRAM_ACCESS_TOKEN` | Token de usuário do Instagram com acesso de mensagens ao perfil profissional. |
| `INSTAGRAM_GRAPH_API_VERSION` | Versão suportada configurada na Meta no formato `vNN.0`. |
| `INSTAGRAM_ENVIOS_BLOQUEADOS` | `true` ou ausente simula os envios humano e automático. Apenas `false` libera, se as credenciais estiverem configuradas. |
| `INSTAGRAM_ATENDIMENTO_IA_PAGA` | `false` ou ausente entrega o fluxo sem modelo pago. Apenas `true` permite o modelo padrão de Leonel fora da homologação e da quarentena. |
| `AMBIENTE` | `homologacao` força a simulação de envios e impede chamadas ao modelo real, inclusive com liberação nas outras variáveis. |
| `SITE_URL` | Domínio HTTPS oficial do cliente para o link de acesso enviado pelo Leonel. |

Guarde o App Secret, o verify token e o access token no ambiente do servidor. Planeje a validade e a rotação do token da conta profissional. `BARBEROS_QUARENTENA_RESTAURACAO` também bloqueia o transporte e o modelo reais.

## Homologação e App Review

1. Use uma conta profissional de teste e pessoas autorizadas pelo aplicativo Meta. Confira os papéis e permissões de cada tester no App Dashboard.
2. Com os envios bloqueados e IA paga desligada, valide o GET de verificação, recepção de texto, entrada duplicada, exibição do canal e registro de resposta simulada. Em teste automatizado é possível injetar um modelo sem rede para demonstrar o turno completo.
3. Para demonstrar a entrega em teste autorizado pela Meta, habilite temporariamente o envio em um ambiente isolado fora de `AMBIENTE=homologacao`, conectado apenas à conta de teste. Grave o tester iniciando uma conversa, o painel recebendo e respondendo, e o retorno no Direct. Mostre o encaminhamento à equipe e, se pertinente, o link de acesso para assuntos da conta.
4. Solicite o nível de acesso indicado pela Meta para `instagram_business_manage_messages`. O guia de webhooks lista Advanced Access e verificação da empresa para o cenário de produção com Instagram Login. Envie descrição e vídeo da utilização, política de privacidade e instruções de exclusão exigidas no painel. Confirme que a conta e as permissões aprovadas recebem mensagens em modo Live antes de liberar os envios de produção. [App Review da Meta](https://developers.facebook.com/docs/app-review/) · [Requisitos de acesso para webhooks](https://developers.facebook.com/documentation/instagram-platform/webhooks/setup#requirements)

## Operação e privacidade

- O painel identifica mensagens simuladas. A moderação de horário vale em ambos os modos e aplica 24 horas estritas. O canal envia texto UTF-8 em partes até 1.000 bytes. Mídia aparece como aviso para a recepção conferir no Instagram. Ecos e notificações de leitura são ignorados.
- A confirmação HTTP ocorre após guardar a entrada. Se o processo cair antes do turno em segundo plano, a mensagem permanece na caixa para a equipe. O reenvio do mesmo evento guarda um único registro e não agenda outro turno. Se uma tentativa ficar pendente ou houver falha parcial, abra o Direct antes de reenviar. O painel registra a tentativa e o canal evita repetir automaticamente uma transmissão de resultado incerto.
- A equipe vê o vínculo de CRM quando um único telefone brasileiro informado corresponde a um cadastro ativo. O vínculo é marcado como não verificado e o WhatsApp do cadastro permanece separado. Toda conversa do Direct começa com acesso público. Assuntos de conta são direcionados ao login oficial sem confirmar se a ficha existe.
- O fluxo minimiza links, documentos, telefones e e-mails no texto da caixa e do modelo. Uma mensagem com indício de senha ou código de acesso tem o texto omitido por inteiro e vai direto à orientação de acesso autenticado. A resposta da equipe pode incluir links HTTPS do domínio oficial para caminhos comuns, sem parâmetros ou links individuais. A área logada exporta os dados da própria conta e a exclusão da conta remove o vínculo de CRM com qualquer conversa do Instagram.
- Receba solicitações de acesso e exclusão do próprio Direct pelos canais da política de privacidade. A equipe deve confirmar o controle do perfil antes de associar uma solicitação ao IGSID e à conversa. Registre o pedido pelo procedimento de privacidade da barbearia e cuide da eventual cópia mantida na Meta. [Política de Privacidade do BarberOS](https://appblackbarber.com/privacidade)
