# Aplicativo no celular e notificações

O cliente e a equipe podem instalar o aplicativo na tela inicial. O ajuste de 24/11 adiciona convite de ativação e detalhes dos atendimentos nas notificações. Está preparado localmente; na consulta de produção, o transporte ainda estava desativado e sem VAPID. A central funciona mesmo com o push desativado.

## Instalar e usar

1. Entre na sua conta pelo endereço seguro da Black Barber. Na equipe, abra **App e notificações**; no cliente, toque no sino do cabeçalho.
2. No Android, use **Instalar aplicativo** quando o botão aparecer. Também pode usar o menu do Chrome ou Edge → **Instalar aplicativo** ou **Adicionar à tela inicial**.
3. No iPhone ou iPad, abra no Safari → **Compartilhar** → **Adicionar à Tela de Início** → **Adicionar**. Abra o ícone instalado. Notificações exigem iOS/iPadOS 16.4 ou posterior.
4. Ao abrir sua conta, aparece **Ative as notificações**, se o aparelho permite e o servidor está configurado. O cliente é orientado a ativar os lembretes; a equipe, os novos agendamentos. Toque em **Ativar notificações** e aceite a solicitação do aparelho. **Agora não** adia o convite por sete dias nessa conta e navegador. A central também oferece **Ativar neste aparelho** a qualquer momento. Instalar não concede automaticamente permissão para avisos.
5. Escolha os assuntos desejados. O cliente tem agenda, avaliações e recompra; recompra começa desmarcada. A equipe tem novos agendamentos e o resumo do dia para profissionais vinculados a uma agenda. O convite respeita a preferência desativada.
6. Em **Seus aparelhos**, desative dispositivos que não usa mais. Sair da conta ou trocar de usuário encerra a inscrição daquele navegador, preservando os outros aparelhos.

As permissões pertencem ao navegador e à origem do site. Instalar em outro navegador ou trocar de endereço pode exigir nova ativação. Se a permissão estiver bloqueada, no iPhone abra **Ajustes → Notificações → o aplicativo → Permitir Notificações**. Em outros navegadores, libere a permissão nas configurações do site e volte à central. Nenhuma permissão nativa é solicitada sem toque.

## Quais avisos são gerados

| Assunto | Quando aparece |
|---|---|
| Agenda do cliente | Conforme os lembretes configurados para o atendimento futuro. Cancelar ou remarcar invalida o aviso antigo. |
| Novo agendamento | O profissional recebe a própria agenda. Dono e gerente recebem as reservas da barbearia, mesmo sem agenda própria, sem duplicação de destinatário. |
| Avaliação interna | Quando a primeira visita é elegível, a avaliação está ativa e há convite válido ainda não respondido. |
| Recompra | Após adesão específica do cliente, com a política ativa e serviços no período de retorno. Respeita o intervalo entre contatos. |
| Rotina da equipe | Um resumo diário para o profissional com agenda ou espaços disponíveis para encaixe. Abre **Meu dia**. |

Novos agendamentos são tentados após a confirmação da reserva, inclusive fora do horário comercial. A fila persistida permite recuperação pela rotina existente. Os demais avisos automáticos são processados a cada cinco minutos, entre 8h e 21h no fuso da barbearia. Lotes são limitados; uma fila grande pode aumentar a espera. Os intervalos atuais dos lembretes não são alterados por esta entrega. A preferência do aplicativo é independente do aceite e dos bloqueios de WhatsApp. A quarentena de restauração continua impedindo envios. Ativar push não habilita campanhas, prêmios ou descontos.

O sino leva à central; **Marcar como lido** atualiza a contagem. Avisos expirados ou que perderam validade deixam de aparecer. Lembretes mostram serviço, data, horário e barbeiro. Novos agendamentos da equipe também mostram o cliente. O convite explica que esses detalhes podem aparecer na tela bloqueada. O texto é recarregado antes do envio para refletir os dados atuais. CPF, contatos, observações e valores não são enviados no push. Avaliações e outros assuntos continuam com a mensagem geral.

## Preparar o envio real

Execute estes passos no processo de publicação autorizado. Não cole chaves privadas no chat ou em arquivos versionados.

1. Aplique a sequência normal de migrações, incluindo `20261028160000_app_notificacoes`, pelo deploy. Faça o backup previsto pelo projeto.
2. Gere um par VAPID uma única vez, em ambiente privado:

   ```bash
   npm run push:chaves
   ```

   O comando cria `.env.push`, ignorado pelo Git, com permissão `0600`. Não sobrescreve arquivo existente e não imprime as chaves. O arquivo não é carregado automaticamente pela aplicação.
3. Transfira as variáveis para a configuração privada do servidor, conservando o restante do `.env`:

   | Variável | Valor |
   |---|---|
   | `VAPID_PUBLIC_KEY` | Chave pública gerada |
   | `VAPID_PRIVATE_KEY` | Chave privada gerada, guardada somente no servidor |
   | `VAPID_SUBJECT` | Contato real, como `mailto:suporte@seu-dominio.com`, ou endereço HTTPS público da barbearia |
   | `PUSH_PROVIDER` | `webpush` para envio real; `simulado` para teste; `desativado` para desligar |

4. Mantenha `SITE_URL` e `PAINEL_URL` corretos, com HTTPS válido. Reinicie a aplicação pelo fluxo de deploy. Confirme que `/sw.js` responde JavaScript sem login nem redirecionamento.
5. Em um aparelho de teste autorizado, instale, entre, ative a permissão e use **Enviar aviso de teste**. Confira com a aplicação fechada e toque no aviso para abrir a própria conta.

Preserve o mesmo par VAPID entre deploys. A troca das chaves invalida inscrições antigas e exige reativação no aparelho. A chave pública é enviada ao navegador; a privada nunca faz parte da resposta da API.

Em homologação (`AMBIENTE=homologacao`), o transporte sempre fica simulado, mesmo com `PUSH_PROVIDER=webpush`. **Simular aviso de teste** cria somente o aviso interno. O teste aceita até três pedidos por hora e reúne pedidos repetidos em menos de um minuto. Sucesso do provedor significa que ele aceitou o envio; não comprova exibição ou leitura no telefone.

## Limites e validação

- É um aplicativo web instalável, sem publicação nas lojas. A instalação e a entrega dependem do navegador e do sistema operacional.
- Sem conexão, aparece uma página pública para tentar novamente. Agendamentos, dados de clientes, HTML privado e respostas da API não são guardados pelo service worker para uso offline.
- O servidor confirma preferências, conta, aparelho e validade do evento antes do envio. Endpoints expirados são desativados; erros de resultado incerto não são reenviados automaticamente. Uma notificação já aceita pelo provedor pode chegar depois da desativação.
- Os testes locais usam banco sintético e transporte simulado. O teste do convite no navegador em formato de iPhone simula a permissão nativa e a inscrição. A exibição real na barra do iPhone com app fechado ainda precisa ser conferida depois da publicação com HTTPS e VAPID definitivo. Foco, permissões de prévias e conexão do aparelho podem alterar a exibição.

Arquitetura e operação: [architecture.md](architecture.md). Checks e evidências: [quality.md](quality.md).
