# Notificações no celular — validação e revisão

Implementação local sobre `77c0ff8`, sem publicação nova ou alteração de configuração em produção. Nenhum cliente real recebeu mensagem neste trabalho. Sem migrations nem novas dependências.

## Evidências locais

- Suíte inicial com 2.563 aprovados. Após implementação e correção da revisão, 2.584 testes aprovados e 160 ignorados pela configuração existente. Tipos, lint, regras locais e build aprovados.
- `tests/notificacoes.fluxo.ts` valida inscrição, isolamento, consentimento, concorrência, revogação, simulação, 410, timeout, 429 e limite de testes.
- `tests/notificacoes-geracao.fluxo.ts` passou 34 verificações em banco exclusivo, incluindo conteúdo do lembrete, relevância e filtros.
- `tests/notificacoes-agenda.fluxo.ts` passou 14 verificações em banco exclusivo, incluindo destinatários, permissão de gerente, remarcação, conteúdo atualizado, cancelamento e entrega sem duplicação fora do horário comercial. Transporte externo proibido.
- Os 21 cenários de estabilização da agenda passaram novamente. A verificação do aviso do profissional foi filtrada por usuário, pois novos avisos para gestão agora são esperados.
- Navegador mobile passou oito cenários com permissão e transporte simulados. Cliente, dono sem agenda, adiamento, bloqueio nativo, iPhone fora do app instalado, preferência desativada, servidor desativado e inscrição ativa.
- O provider de produção foi apenas consultado. Está desativado e sem VAPID. Lembretes atuais configurados para 24 horas e 90 minutos antes, preservados.
- A revisão independente identificou falha na recarga do texto depois de reservar a entrega. Reproduzida em teste e corrigida para reagendar falhas anteriores ao provedor, com limite de três tentativas e sem classificá-las como envio incerto. `tests/notificacoes-envio-dados.test.ts` prova os dois limites.

## Revisão recomendada

Sugerem-se três ciclos pela combinação de permissão de aparelho, dados na tela bloqueada e destinatários por papel. A sugestão não impede concluir os checks locais nem autoriza execução de rodadas adicionais.

Prompt copiável

> Revise as notificações do celular em três ciclos. Primeiro confira convite, gesto de permissão, instalação no iPhone, adiamento, troca de conta e revogação do aparelho. Segundo confira destinatários por papel, vínculo do barbeiro, mudanças antes do envio e limites de conteúdo. Por último confira transação/fila, entrega depois da reserva, cron independente de WhatsApp, quarentena, idempotência e recuperação de falhas. Execute npm run lint, npm run lint:rules, npm run typecheck, npm test e os três fluxos tests/notificacoes.fluxo.ts, tests/notificacoes-geracao.fluxo.ts e tests/notificacoes-agenda.fluxo.ts em seus bancos sintéticos exclusivos. Não publique nem envie mensagens reais sem pedido.

## Pendente de operação autorizada

Commit, publicação sobre a versão efetivamente instalada, VAPID persistente com contato HTTPS da Black, conferência do cron e teste em aparelho autorizado com app fechado. O aceite do serviço push não comprova exibição ou leitura no iPhone. Conferir o aviso e a abertura da conta certa no aparelho.
