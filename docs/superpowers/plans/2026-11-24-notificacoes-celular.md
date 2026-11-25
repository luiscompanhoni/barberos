# Plano de notificações no celular

**Objetivo** — Autorizar e receber avisos de agenda no sistema operacional com o aplicativo fechado.

**Arquitetura** — Reutilizar componentes de instalação, Web Push, fila persistida, geração e transporte. Sem dependências, migrations ou novo canal externo. Permissão continua pertencendo a cada aparelho e origem.

**Especificação** — [Design](../specs/2026-11-24-notificacoes-celular-design.md).

## Restrições e revisão

Não publicar nem mudar configuração de produção sem pedido explícito. Não emitir mensagens a clientes reais durante testes. Verificar troca de conta, permissão negada, remarcação antes do envio, gerente sem agenda própria e bloqueio de WhatsApp.

## Tarefas

1. Detalhes e destinatários em `novo-agendamento.ts`, `geracao.ts`, `geracao-relevancia.ts`, `provedor.ts` e `public/sw.js`. Escrever testes de detalhes, destinatários, dados antigos e payload genérico, observar falha e implementar. Validar testes unitários e fluxos de notificações em banco sintético.
2. Entrega após reserva nas rotas de agendamento/pedidos e no bot, com escopo exato do evento e fallback pelo cron. Mover rotina push antes das saídas por WhatsApp, mantendo quarentena. Testar escopo, concorrência e bloqueios.
3. Convite nos layouts autenticados e ajuda na central. Reutilizar Modal e ativarPush. Cobrir suporte, intervalo de sete dias, conta e preferências. Provar no navegador mobile que importar/montar não pede permissão, só o toque e que fechar/recusar não insiste.
4. Atualizar guia, arquitetura e pendências. Executar suíte, tipos, lint e build, revisar diff e registrar limites reais. Preparar pedido de commit/publicação com resultado concreto.

## Execução

- Base limpa `77c0ff8`. Suíte inicial 2.563 testes aprovados, 160 ignorados conforme configuração existente.
- Execução local na worktree já isolada, branch `notificacoes-celular-20261124`. Alterações da pasta original preservadas.
- Tarefas 1 a 3 implementadas e verificadas. Revisão independente encontrou uma falha pré-provedor na recarga do texto, reproduzida RED→GREEN e corrigida com repetição limitada. O build passou após a correção.
- Tarefa 4 documentada. Suíte com 2.584 aprovados, 160 ignorados. Três fluxos de notificações e oito cenários de navegador aprovados. Publicação e conferência física do push seguem pendentes de pedido explícito, conforme AGENTS.md.
