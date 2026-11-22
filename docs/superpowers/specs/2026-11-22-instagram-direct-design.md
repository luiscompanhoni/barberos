# Leonel no Instagram Direct

Quem chega pelo Instagram inicia uma conversa como lead. A recepção vê o canal, assume a conversa e continua pela mesma caixa. Leonel usa o agente, o contexto e o catálogo de ferramentas existentes. Consultas de cadastro, pagamentos e alterações de conta exigem prova de titularidade. Um telefone informado no Direct permite vincular a conversa à ficha para a equipe e encaminhar o cliente ao acesso autenticado quando houver dados privados.

## Decisões

- Usar Instagram API with Instagram Login. O webhook fica em `https://painel.appblackbarber.com/api/instagram/webhook`. Recebe o campo `messages`, checa token no GET e assinatura HMAC SHA-256 sobre os bytes originais no POST. Valida perfil receptor, descarta ecos, deduplica por `mid` persistido e usa o instante da mensagem para a janela.
- Usar a mesma caixa de entrada e o mesmo motor de Leonel. A alternativa de uma caixa separada duplicaria permissões e estado de atendimento. O número informado é um vínculo de CRM, não credencial. Manter o IGSID e os eventos em namespace próprio para o WhatsApp continuar isolado.
- A janela padrão é estrita de 24 horas. O canal envia texto simples em partes que respeitam o limite do Instagram. A entrega automática e humana ficam bloqueadas por padrão. A simulação registra o efeito sem enviar. IA externa exige chave própria de autorização e, em homologação, modelo injetado para testes.
- Ignorar mídia que não tem texto na primeira versão e sinalizar para conferência humana. Restringir textos do modelo em operações privadas, redigir dados sensíveis e manter exportação/exclusão dos dados pessoais compatível com o vínculo.
- O App Review deve demonstrar uma conversa iniciada pelo cliente, resposta e painel. Em modo de desenvolvimento, usar apenas conta profissional e testers autorizados. Ativar a integração após homologação e confirmação das permissões reais.
