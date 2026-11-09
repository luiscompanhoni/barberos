# Preparação do login social

Estado em 09/11/2026: sem aplicativos de provedor cadastrados, conforme confirmação do dono.
Os botões indisponíveis não iniciam autorização. O acesso único por celular e senha/código usa o perfil
do banco. O login social existente atende contas de cliente; não promove clientes nem vincula equipe
por coincidência de nome ou e-mail.

## Configuração esperada pelo código

No servidor, nunca no navegador ou no chat:

| Provedor | Variáveis | Retorno cadastrado |
| --- | --- | --- |
| Google | AUTH_GOOGLE_CLIENT_ID, AUTH_GOOGLE_CLIENT_SECRET | SITE_URL/api/auth/social/google/retorno |
| Facebook | AUTH_FACEBOOK_CLIENT_ID, AUTH_FACEBOOK_CLIENT_SECRET, AUTH_FACEBOOK_API_VERSION | SITE_URL/api/auth/social/facebook/retorno |
| Apple | AUTH_APPLE_CLIENT_ID, AUTH_APPLE_CLIENT_SECRET | SITE_URL/api/auth/social/apple/retorno |

`SITE_URL` é substituído pelo endereço HTTPS real configurado. A versão Facebook deve estar explicitamente
suportada e no formato `vN.N`. Apple exige HTTPS. Esta tabela descreve a implementação existente;
cadastros, condições e exigências atuais precisam ser conferidos nos painéis oficiais antes da ativação.

O responsável deverá criar os aplicativos, configurar domínio, retornos, privacidade e permissões mínimas;
concluir verificações/aceites exigidos pelo provedor e armazenar segredos no cofre/configuração do servidor.
Testar cancelamento, identidade inválida, vínculo com celular confirmado e ausência de escalada de função
com contas de teste antes de disponibilizar cada botão. Não contratar plano ou ativar login social sem
concluir esses passos. Não enviar segredos por chat, GitHub ou capturas de tela.
