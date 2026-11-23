# Plano de implementação do Instagram Direct

> **Execução:** superpowers:subagent-driven-development. As etapas usam caixas de seleção.

**Objetivo.** Atender pelo Direct com o Leonel e identificar o canal na caixa da recepção.

**Arquitetura.** A entrada assina e registra mensagens antes de responder. A mesma conversa do painel controla o turno do agente e a entrega no transporte Instagram.

**Stack.** Next.js, Prisma, PostgreSQL, Vitest, Instagram API with Instagram Login.

**Especificação.** `docs/superpowers/specs/2026-11-22-instagram-direct-design.md`.

## Restrições globais

- Trabalho na branch `crescimento/dezembro-20261122`. Migração aditiva aplicada só ao PostgreSQL local com backup.
- `INSTAGRAM_ENVIOS_BLOQUEADOS` bloqueia por padrão. Nunca mudar o bloqueio WhatsApp. Testes de rede por substitutos.
- Telefone no Direct vincula ficha existente e não autentica. Um lead só pode usar ferramentas públicas e atendimento humano.
- Webhook usa assinatura SHA-256, horário do provedor, ID do perfil e `mid`. Fora da janela de 24 horas, bloquear todos os envios do canal.

## Focos de revisão

- Assinaturas sobre bytes exatos e cabeçalhos inválidos.
- Duplicata concorrente e mensagem velha que chega depois de uma nova.
- Telefone de terceiro não concede ferramentas privadas.
- Atendimento humano e bot respeitam o mesmo canal, bloqueio e janela.
- Ficha com conversa WhatsApp mantém os dois canais e exclusão aplica minimização.

### Task 1: Webhook, agente e caixa de entrada

**Arquivos.** `src/lib/instagram/`, `src/app/api/instagram/webhook/route.ts`, rotas e componentes de Conversas, `src/lib/whatsapp/conversas.ts` para desvio do transporte se necessário, testes `instagram-*.test.ts`, docs `instagram-direct-leonel.md`. O coordenador aplica `prisma/schema.prisma`, e esta tarefa tem migração exclusiva.

**Interface.** `Conversa.instagramIgsid String? @unique`, `Conversa.instagramClienteId String?` e relação dedicada para `Cliente`. `Conversa.telefone` recebe valor interno `instagram:<igsid>` para manter índice e retrocompatibilidade. Mensagens com `wamid` namespaced `instagram:<mid>`. Papel de cliente vem da sessão do app, nunca do Direct.

- [x] Escrever e rodar testes para protocolo, rejeição de ecos/perfil divergente, janela, idempotência, vínculo e bloqueio.
- [x] Registrar recebimento e atualizar o identificador/horário da entrada sob trava de conversa. Manter processamento após reconhecimento do webhook e registrar falhas para a recepção.
- [x] Adaptar o agente existente e a entrega. Revalidar janela/estado antes do transporte, excluir operações privadas e rotas/ações WhatsApp do Direct.
- [x] Mostrar Instagram na caixa e documentar App Review, configuração, privacidade e ativação.
- [x] Rodar testes, lint, types e entregar commits em pt-BR.
