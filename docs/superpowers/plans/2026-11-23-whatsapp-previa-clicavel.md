# Preservação da prévia clicável do WhatsApp

> Para execução por agentes, use superpowers:subagent-driven-development. As etapas usam caixas de seleção para acompanhar o progresso.

**Objetivo**: preservar o cartão e o fluxo restrito da roleta que já rodam em produção.

**Arquitetura**: reaplicar a opção no transporte da Evolution, aproveitar a jornada de convites existente e fixar no Compose da publicação a imagem local em uso.

**Stack**: TypeScript, Vitest, Prisma, Python, Docker Compose.

**Especificação**: `docs/superpowers/specs/2026-11-23-whatsapp-previa-clicavel-design.md`.

## Restrições

- VPS somente leitura. Sem push, publicação, mensagens reais ou IA paga.
- Base de comparação `6437737`, app ativo `e434997`, imagem Evolution `barberos-evolution:2.3.7-previa-clicavel`.
- Preserve Direct, travas de envio, controles do piloto e regras de campanha posteriores à base.

## Pontos de revisão

- Prévia ausente em texto comum e presente no último balão de jornada de roleta.
- Flag em uma conversa Direct e em um envio bloqueado não chega ao transporte.
- Token de teste com outra campanha, status ou lote não abre uma roleta inativa.
- Primeira ajuda fora do horário exige leitura e fluxo de teste ainda elegível.
- Tag local ausente ou diferente do ID em execução impede substituição silenciosa.

### Task 1: Prévia no transporte e no convite

**Arquivos:** `src/lib/whatsapp/{evolution,canal,conversas,convite-app}.ts`, `tests/whatsapp-presenca.test.ts`, testes WhatsApp e de convite pertinentes.

**Interface:** adicione `previaRoleta?: boolean` às opções de `enviarNaConversa` e o último argumento opcional booleano a `enviarTexto` e `enviarTextoEvolution`.

- [x] Escrever regressões para `linkPreview: true` com `delay` e `wamid`, texto comum sem flag, bloqueios e só o último balão de roleta com flag.
- [x] Executar os testes focados e confirmar a falha da expectativa nova.
- [x] Passar a opção pelo fluxo de envio normal, com as mesmas checagens e sem alcançar o lote autorizado, templates, Direct ou Cloud. Marcar o último balão de roleta.
- [x] Executar os testes focados e conferir compatibilidade com os chamadores existentes.

### Task 2: Jornada restrita existente e conteúdo publicado

**Arquivos:** `src/lib/whatsapp/{convite-app,status}.ts`, `src/lib/convites/{link,jornada-leonel,roleta-leonel,retomadas}.ts`, `src/lib/campanhas/link.ts`, `src/lib/jogos/motor.ts`, `src/lib/bot/prompt.ts`, `public/brand/black/previa-roleta-ygor-v1.jpg` e testes focados.

**Interface:** preserve os três argumentos atuais de `iniciarConviteApp` e acrescente `testeFrio = false` interno. Reutilize a opção da tarefa 1. Use `PREFIXO_TESTE_FRIO = "rott_"`, `CAMPANHA_TESTE_FRIO = "teste-automatico-leonel-frio"`, `ehTokenTesteFrio` e `permiteRoletaTeste` como na fonte anterior.

- [x] Escrever testes para a autorização do próprio dono, token/lote/campanha restritos, prévia de envio reservado, jogada de teste e primeira ajuda após leitura. Validar casos fora da exceção e bloqueio de transporte.
- [x] Executar os testes e confirmar que a branch anterior falha nos cenários recuperados.
- [x] Incorporar só os deltas confirmados no compilado. Manter a rota de gestão com três argumentos. Atualizar a arte e o texto do convite frio e preservar no prompt a instrução sobre pedidos pendentes.
- [x] Reexecutar testes focados e cobrir a jornada comum e o Direct no ensaio local.

### Task 3: Preservação da Evolution na publicação

**Arquivos:** `scripts/publicacao/deploy_vps.py`, testes Python de publicação e `deploy/evolution.Dockerfile`.

**Interface:** o publicador identifica o serviço Evolution na instalação e registra `image` e `pull_policy: never` no override quando a imagem customizada estiver instalada. O Compose base não precisa de uma imagem que só existe na VPS.

- [x] Escrever regressões de publicação com a imagem instalada, verificação do ID associado à tag, retoma do container original e cenário de instalação sem a imagem adaptada.
- [x] Executar os testes e observar a falha sobre a ausência do override ou da conferência.
- [x] Persistir a imagem adaptada verificada no override e conferir que o container original retornou. Guardar o Dockerfile recuperado, com fallback de miniatura compacta.
- [x] Executar `npm run check:publicacao:servidor`. Conferir a resolução do Compose em configuração sintética local, sem subir serviços.

### Task 4: Validação integrada e documentação

**Arquivos:** `PREVIA-PUBLICACAO-20261123.md` e registros deste plano.

- [x] Documentar o comportamento em linguagem simples e atualizar a evidência técnica, mantendo o histórico do ensaio de migração.
- [x] Rodar `npm run check`, `npm run check:publicacao:servidor`, testes condicionais de Vitest e `npm run teste:todos` em banco local descartável.
- [x] Revisar diff da branch e resolver achados ligados à entrega. Conferir que o Git não contém arquivos privados e fazer o commit local.
