# Resultado do Direct do Leonel com login do Facebook

23/11/2026, horário de São Paulo · branch `crescimento/dezembro-20261122`

O BarberOS está adaptado ao **Black Barber Direct** (`2751816731904059`) e validado localmente. A entrega com o app real ainda depende da configuração e do ensaio na Meta. O roteiro começa na [configuração do Black Barber Direct](docs/instagram-direct-leonel.md).

## O que mudou

- `facebook_login` passou a ser o padrão. O transporte usa `graph.facebook.com/{versão}/{PAGE_ID}/messages`, Page access token e o IGSID recebido no webhook. `instagram_login` segue disponível por configuração explícita para instalações que já usam `graph.instagram.com`.
- Fixei `v26.0` como padrão do Facebook por constar com data de lançamento na tabela oficial consultada. A versão segue configurável e a introdução da Meta já exibe `v27.0`. [Calendário de versões da Meta](https://developers.facebook.com/docs/graph-api/changelog/versions/) · [Visão geral da Graph API](https://developers.facebook.com/docs/graph-api/)
- A rota usa o App Secret para verificar os bytes do `POST` e valida o ID do perfil profissional. A página vinculada autoriza o envio. Os modos compartilham a caixa, a moderação de 24 horas, os filtros de ecos, a idempotência por `mid`, o atendimento do Leonel, o vínculo por telefone e a recuperação de pendências.
- Envios seguem simulados por padrão. Homologação e quarentena forçam simulação. IA paga continua desligada por padrão.
- Conversas passou a reservar espaço para o menu fixo no celular. A correção deixa **Enviar** tocável também em telas nas quais o menu da equipe fica no rodapé.

## Validação

- **Suíte principal.** `npm test` passou 2.507 testes em 279 arquivos. As suítes condicionais foram executadas à parte. Passaram ainda `npm run lint`, `npm run lint:rules`, `npm run typecheck` e `npm run build` com Next.js 16.4.6.
- **Direct.** Passaram 35 testes focados do transporte e do webhook e 11 no PostgreSQL local. O teste concorrente verificou uma entrada e uma resposta simulada para duas notificações assinadas com o mesmo `mid`. A suíte cobriu também desafio, assinatura, perfil incorreto, ecos, isolamento de credenciais, janela, privacidade e recuperação.
- **Navegador.** Vercel agent-browser 0.43.0 com dados fictícios em 390 × 844. Dois POSTs assinados retornaram HTTP 200. A caixa exibiu uma mensagem do contato, a orientação simulada do Leonel e a resposta simulada após a equipe assumir a conversa e clicar em **Enviar**. A consulta no banco confirmou zero ecos e zero pendências do turno. O botão respondeu ao teste de posição em 320 × 568, 768 × 1024 e 1280 × 900. O navegador registrou zero erros de página.
- **Suítes condicionais.** Passaram 157 testes em PostgreSQL local, incluindo os 11 do Direct, em 15 arquivos. Os checks de preparação e recuperação passaram 102 testes Node e 190 Python, em ambiente local.
- **Fluxos.** `npm run teste:todos` executou 28 scripts. Passaram 22, com 605 verificações. Os seis restantes (`pagarme`, `automacoes`, `crescimento`, `financeiro`, `campanhas` e `evolucao`) esperavam registros gerados por envios do WhatsApp no simulador. A execução manteve `WHATSAPP_ENVIOS_BLOQUEADOS=true` inclusive quando um script tentou trocar o valor. As verificações do Direct passaram separadamente.

## O que Ygor precisa fazer

1. Abrir o app `2751816731904059`, conferir o vínculo direto entre a página **Black Barber** e **@blackbarberrds**, ativar **Permitir acesso às mensagens** e aceitar os convites dos testers.
2. Configurar o **Login do Facebook para Empresas** no caso de uso unificado. Conceder as permissões do roteiro, obter o ID da página e gerar e validar o token de página de longa duração para o app.
3. Com a rota disponível por publicação separadamente autorizada, configurar as credenciais no ambiente privado do servidor e manter a simulação. Verificar `https://painel.appblackbarber.com/api/instagram/webhook`, assinar `messages` no objeto **Instagram** e inscrever a página em `/{page-id}/subscribed_apps`. Conferir o roteamento se houver outras ferramentas no Direct.
4. Concluir a **Verificação da Empresa** e as perguntas de tratamento de dados. Antes de gravar e submeter o pedido de **Advanced Access / App Review**, concluir o tratamento de mensagens desfeitas pelo remetente e demonstrá-lo à Meta. O BarberOS hoje descarta o evento `is_deleted` na entrada e conserva a cópia já armazenada. Esse tratamento também é pré-requisito para a liberação pública. Se a Meta pedir entrega real para a revisão, siga o fluxo do painel com testers e ativos de teste em um ensaio isolado e autorizado. [Revisão para apps do próprio negócio](https://developers.facebook.com/documentation/business-messaging/instagram-messaging/app-review/apps-for-your-own-business) · [Requisitos de Instagram Messaging](https://developers.facebook.com/documentation/business-messaging/instagram-messaging/overview#requirements)
5. Validar o recebimento de um DM iniciado por tester com a simulação ligada. Após os aceites da Meta e do ensaio e a autorização para produção, definir `INSTAGRAM_ENVIOS_BLOQUEADOS="false"` conforme o manual. Manter a IA paga desligada até decisão separada.

O trabalho ficou em commits locais. A validação usou PostgreSQL Docker, mensagens fictícias, rede de envio simulada e documentação pública da Meta.
