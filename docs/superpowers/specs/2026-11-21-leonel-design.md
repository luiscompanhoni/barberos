# Leonel da Black

Este ajuste preserva o treinamento e as falas da recepção. O primeiro contato de campanha tem duas mensagens, sem oferta ou link. Um aceite claro libera a continuação. Recusa e pedido de saída têm efeitos distintos. O bot se apresenta como Leonel da Black e informa que é assistente quando perguntado, conforme o treinamento atual.

## Percursos

- Cliente sumido recebe as duas falas conhecidas da reativação. Se responder com interesse, recebe a oferta. Se estiver frio ou muito frio, o primeiro link abre a roleta de campanha diretamente.
- Quem ganha vê o prêmio e segue para marcar. A verificação do telefone retoma a ficha existente e preserva o destino e o prêmio. A jornada registra o giro e o resultado, e pode oferecer ajuda uma vez se a pessoa parar.
- Assinante continua usando o mesmo plano, catálogo e agenda. A régua mede visitas concluídas e independe de adimplência. Uma conversa de migração ou com a recepção tem prioridade sobre campanha.
- Ygor confere rascunhos, associa a roleta e libera lotes manualmente. A régua mostra quatro temperaturas. O funil filtra pela data do giro no fuso da barbearia e apresenta perdas na jornada direta e na assistida.
- Leonel encaminha à equipe quando o transporte está bloqueado ou o atendimento automático não está disponível. A conversa já chega registrada na caixa da equipe, com uma nota interna.
- O barbeiro usa a agenda como de costume. O agendamento associado, o status do atendimento, o envio de lembrete e o agradecimento alimentam a jornada.
- O novo cliente pode usar a agenda e a verificação de telefone existentes. Cadastros sem visita continuam em grupo próprio.

## Decisões de implementação

- Adotar a régua comum de 30, 90 e 180 dias com o último atendimento concluído. Preservar as chaves históricas de segmentação de um ano para campanhas gravadas. Elas são subdivisões de muito frio.
- Reaproveitar a abertura e o classificador determinístico do convite. Guardar a abertura confirmada, a primeira resposta e a tentativa de continuação por envio. Reutilizar templates aprovados apenas para os balões de abertura fora da janela oficial, com dois nomes distintos. Invalidar hashes de lotes anteriores ao novo protocolo. Um lote excepcional conferido durante bloqueio pode autorizar somente as falas de abertura.
- O link frio precisa de uma roleta ativa associada. Se não estiver pronta, a campanha registra o impedimento em vez de enviar um caminho que não entrega o prometido. Links antigos preservam seus destinos gravados.
- Registrar uma jornada por jogada, com timestamps por transição. O agendamento com prêmio tem prioridade. Um horário futuro sem prêmio só é atribuído quando existe uma jornada recente inequívoca. Gravar primeiro comparecimento e conclusão no fluxo de agenda e reaproveitar os lembretes existentes.
- Configuração inicial da trilha desligada, atraso padrão de 4 horas e upsell desligado. A configuração é operacional, via variáveis documentadas. Na API oficial, o nudge e a oferta pós-corte exigem janela aberta. Preferir a ajuda com o próximo horário como primeiro upsell e registrar aceite explícito. O aceite registra intenção para a recepção concluir.
- Reservar a única tentativa no banco antes do transporte e medir envio somente quando confirmado. Manter etapas diretas no funil mesmo que não exista nudge. Usar somente migrações aditivas, com rollback ensaiado num banco descartável.

Uma tabela simples de mensagens pendentes resolveria cadência, mas perderia o vínculo com a jogada e a agenda. A reconstrução a partir de históricos serviria para estimar conversão e não permitiria comprovar o instante das transições nem controlar a única tentativa. Campos de transição por jogada reutilizam os identificadores existentes e mantêm os dados de origem intactos.
