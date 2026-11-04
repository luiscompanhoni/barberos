# Quarentena para restauração de backup

O ambiente restaurado pode conter filas e registros anteriores a pagamentos ou mensagens já ocorridos. Iniciar a aplicação normalmente poderia executar essas tarefas outra vez. A opção de processo `BARBEROS_QUARENTENA_RESTAURACAO=true` deve ser configurada **antes** de iniciar qualquer cópia restaurada. Seu valor fica fora do banco para que restaurar um dump não desative a proteção. Qualquer valor não vazio diferente de `false` mantém a quarentena ativa; ausente ou `false` conserva o comportamento normal.

Quando ativa, a inicialização não agenda as rotinas de agentes, pagamentos e automações. As entradas principais dessas rotinas e da caixa de webhooks de pagamento não executam trabalho; as três rotas de webhook de pagamento autenticadas respondem 503 sem gravar entrada ou confirmar recebimento. A configuração não modifica nem limpa a fila ou os dados restaurados.

**A flag não é uma barreira completa.** Ela não bloqueia toda ação manual, trabalhadores ou serviços externos, callbacks já em execução em outro processo, tráfego direto ao gateway/WhatsApp nem o processador do Estúdio. Ela também não apaga credenciais nem impede conexões fora do aplicativo. Um webhook recusado durante a quarentena não é armazenado aqui; provedores podem ter janela limitada de reenvio. Não tratar um 503 como garantia de recuperação do evento.

## Procedimento de ensaio isolado

1. Pare o destino isolado e confirme que não há processos antigos, timers, filas de worker ou callbacks em execução. Uma ação já iniciada em outro processo não pode ser desfeita por essa flag.
2. Use um banco e armazenamento novos, sem acesso público, com rede de saída bloqueada e sem credenciais de produção. Não use o banco, mídia, conta ou telefone reais como destino de teste. Mantenha gateways e WhatsApp simulados, IA paga e campanhas desativadas. Configure a quarentena em **todos** os processos da cópia antes de iniciar o aplicativo.
3. Restaure e valide o par de backup de banco e mídias nos destinos isolados, confirme versões, migrações, contagens e integridade. Confira que os três webhooks respondem 503 a solicitações de teste autenticadas e que os registros de tarefas continuam inalterados; sem credenciais ou chamadas reais. Nunca sobrescreva produção para executar este ensaio.
4. Antes de planejar qualquer retorno operacional, compare os movimentos desde a data do backup com os provedores e os registros atuais. Faturas, pagamentos, estornos, mensagens, convites, saídas Pix, tarefas do Estúdio e estados `PENDENTE`, `PROCESSANDO`, `REVISAO`, `INCERTA` ou `EMITINDO` exigem reconciliação com evidência externa. Um dump pode ser anterior a um efeito externo já concluído. Não reenvie, não emita e não reexecute tarefas cegamente; registre lacunas dos webhooks que podem ter expirado no provedor.
5. A remoção da quarentena exige revisão do resultado, resolução dos estados incertos, plano de reconciliação/retomada e autorização própria. Reinicie processos somente depois dessa decisão, com acesso e limites explicitamente definidos. A reabertura não é automática nem faz parte desta alteração.

## Verificação local

`tests/quarentena-instrumentacao.test.ts` confere que o bootstrap não agenda tarefas com a flag ativa, preserva o comportamento anterior quando ausente e falha fechado para valores não reconhecidos. `tests/quarentena-rotinas.test.ts` confirma que as entradas principais retornam sem acessar o banco mesmo com flag de cobrança ligada. `tests/webhook-entrada-rotas.test.ts` verifica resposta 503 e ausência de gravação/agendamento nas três rotas. O script `scripts/teste-ciclo2-webhook.ts` exercita, em banco local descartável com executor fictício, a preservação de uma entrada pendente durante a quarentena.

Esses testes não são uma restauração real da produção, não verificam todos os workers e não comprovam o reenvio dos provedores nem a ausência de efeitos já iniciados em outros processos.
