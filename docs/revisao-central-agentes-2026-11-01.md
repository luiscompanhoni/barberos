# Revisão da Central de Agentes — quatro ciclos, 01/11/2026

Escopo: Black Barber. Revisão local da implementação sobre a base `ea5b5222b488f2aa45f9884e15624f501b7e9250`. Não houve publicação, commit, push, anúncio, envio, chamada real de IA ou operação financeira real.

Resultado: 11 achados corrigidos no código (1 P1 e 10 P2). P1 indica impacto alto; P2, impacto moderado. A conferência visual do ajuste de revogação continua pendente. As correções internas foram reavaliadas nos mesmos quatro ciclos.

## Ciclo 1 — Identidade, origem, privacidade e duplicidade

### C1-01 · P2 · Falsa divergência em métricas repetidas da Meta

Local: `src/lib/agentes/meta.ts:175`. **Corrigido.**

**Antes:** As mesmas ações em ordem diferente eram rejeitadas como métricas divergentes.

**Correção:** Comparação por hash canônico; divergências reais continuam sendo recusadas.

**Evidência:** Teste reproduziu a falha antes e passou após a correção; cobertura de duplicidade e divergência preservada.

### C1-02 · P2 · Limite de mensagens sem identificação da unidade

Local: `src/lib/agentes/contexto.ts:32`. **Corrigido.**

**Antes:** O contexto chamado campanhas continha limiteDiario sem canal ou unidade, permitindo confusão com orçamento de anúncios.

**Correção:** A fonte identifica WhatsApp, unidade mensagens e explica que o limite não representa dinheiro.

**Evidência:** Teste falhou antes e passou depois; testes adicionais conferem escopo do Estúdio e exclusão de rankings nominais do contexto.

Validação do ciclo: duas falhas reproduzidas; depois, 33 testes passaram em quatro arquivos. Nenhuma ligação entre pessoas ou operação de conciliação financeira foi aplicada.

## Ciclo 2 — Transações, concorrência, cancelamento e auditoria

### C2-01 · P2 · Consumo perdido em resposta rejeitada

Local: `src/lib/agentes/processar.ts:95`. **Corrigido.**

**Antes:** Resposta inválida ou truncada consumia tokens, mas o registro mantinha consumo zero.

**Correção:** A falha transporta apenas uso conhecido e erro sanitizado; o executor persiste consumo e auditoria sem guardar conteúdo rejeitado.

**Evidência:** Regressão 0 versus 23 tokens reproduzida; teste de banco confirma 23/45 tokens e auditoria única; unitário cobre JSON inválido, truncamento e schema inválido.

### C2-02 · P2 · Aprovação bloqueada pela própria vaga na fila

Local: `src/lib/agentes/servico.ts:65`. **Corrigido.**

**Antes:** Com 100 trabalhos abertos, aprovar um resultado com um filho falhava antes de liberar a vaga do pai.

**Correção:** O pai é concluído antes dos filhos, na mesma transação. Qualquer falha desfaz todas as alterações.

**Evidência:** Reprodução em fila cheia; aprovação de um filho passou. Quando o segundo filho excede o limite, pai, primeiro filho e auditoria permanecem como antes.

### C2-03 · P2 · Repetição perdia rotina e permitia trabalho duplicado

Local: `src/lib/agentes/servico.ts:73`. **Corrigido.**

**Antes:** A nova tentativa ficava sem rotinaId; o agendador podia criar trabalho paralelo e novos cliques podiam gerar outras tentativas.

**Correção:** Preserva rotina, reaproveita repetição aberta e recusa repetir uma falha antiga enquanto outro período da rotina estiver aberto.

**Evidência:** Falha de rotinaId nulo reproduzida; teste verifica repetição, próximo vencimento, clique repetido e conflito com outro período.

### C2-04 · P1 · Fila cheia impedia o trabalhador de avançar

Local: `src/lib/agentes/rotinas.ts:54`. **Corrigido.**

**Antes:** Rotina vencida tentava enfileirar com 100 trabalhos, lançava erro e interrompia o ciclo antes de processar a fila existente.

**Correção:** Adia a inclusão ao atingir o limite e devolve normalmente o controle ao trabalhador.

**Evidência:** Reprodução com 100 trabalhos e rotina vencida; após a correção nenhuma inclusão é feita e um trabalho existente é processado.

### C2-05 · P2 · Repetição de encaminhamento perdia o briefing

Local: `src/lib/agentes/servico.ts:81`. **Corrigido.**

**Antes:** A origem era trocada pela execução falha sem resultado, eliminando o briefing recebido do agente anterior.

**Correção:** Preserva a origem original e registra na auditoria o vínculo entre a falha e a nova execução.

**Evidência:** Origem incorreta reproduzida; teste confirma o briefing original no contexto efetivamente processado e a auditoria da repetição.

### C2-06 · P2 · Reserva vencida ainda iniciava chamada de IA

Local: `src/lib/agentes/processar.ts:54`. **Corrigido.**

**Antes:** A reserva podia vencer durante a coleta de contexto sem impedir a chamada seguinte ao provedor.

**Correção:** Confere a validade da reserva novamente antes da chamada e registra a falha se estiver vencida.

**Evidência:** Teste vence a reserva durante a coleta e confirma zero chamadas ao modelo e estado FALHOU.

Cinco falhas foram reproduzidas no banco antes das correções. A reserva vencida ganhou regressão específica. O fluxo final também prova rollback de aprovação/filhos/auditoria e preservação de estorno parcial. Cancelamento atua por tarefa; derivados já criados continuam e precisam de cancelamento separado, conforme explicado na interface.

## Ciclo 3 — Permissão, interface e preservação dos dados

### C3-01 · P2 · Histórico recente escondia pendências antigas

Local: `src/lib/agentes/servico.ts:12`. **Corrigido.**

**Antes:** Mais de 100 encerramentos recentes tiravam da tela uma tarefa antiga ainda aberta, embora ela continuasse ocupando a fila.

**Correção:** Prioriza trabalhos abertos e completa até 100 registros com histórico. As duas consultas compartilham um retrato consistente para evitar duplicação durante encerramentos.

**Evidência:** Falha reproduzida com 110 encerramentos; teste final mantém a pendência visível e limita o resultado a 100 registros.

### C3-02 · P2 · Tela mantinha dados após revogação de acesso

Local: `src/components/agentes/AgentesTela.tsx:28`. **Corrigido.**

**Antes:** Uma resposta 401/403 mantinha o painel anterior visível; uma leitura já iniciada podia repor os dados.

**Correção:** Limpa o painel e invalida a sequência de respostas anteriores ao receber 401/403, tanto em leitura quanto em mutação.

**Evidência:** Código e tipos conferidos; handlers cobertos para 401/403 e isolamento entre donos no banco. A interação real no navegador permanece pendente.

A pendência invisível foi reproduzida no banco. Cobertura adicional: 401/403, feature desligada, origem externa, dono da sessão, corpo inválido/grande e no-store nos handlers; outro dono não pode ler/alterar a execução alheia. Sem servidor HTTP ou navegação real.

## Ciclo 4 — Integração, migração, backup e recuperação

### C4-01 · P2 · Homologação podia herdar execução paga e token Meta

Local: `deploy/docker-compose.homolog.yml:31`. **Corrigido.**

**Antes:** O compose lia o .env compartilhado sem sobrepor as novas configurações da central.

**Correção:** Homologação força execução dos agentes desligada e token Meta vazio; exemplos de ambiente documentam os padrões desligados.

**Evidência:** YAML analisado com js-yaml e valores de sobreposição conferidos. Docker não está disponível no ambiente local, portanto o compose não foi iniciado.

Backup custom do PostgreSQL restaurado antes e depois da migração. Comparação integral das linhas serializadas e hashes, não só contagens. Migração 46 → 47 aplicada em banco com fixtures e em sua restauração; clientes, comandas, pagamentos, estorno, transferências, despesas e auditoria preservados. Schema comparado sem diferenças.

Backup posterior restaurou 1702 execuções, 18 rotinas e 332 registros de auditoria sintéticos, além dos dados financeiros. Nenhuma tarefa restaurada foi executada.

## Verificação final

- `npm run check`: aprovado; lint, regras locais, tipos, 625 testes em 72 arquivos e build.
- `npm run teste:agentes`: aprovado; 21 verificações no banco descartável `barberos_agentes_teste`, em 127.0.0.1:55437, com modelo falso e fetch bloqueado.
- Preservação financeira compara todas as colunas e vínculos de fixtures não vazias antes/depois do fluxo.
- `prisma migrate diff`: sem diferenças nos bancos migrados. `git diff --check`: aprovado.
- Compose: YAML e valores explícitos de homologação conferidos; sem inicialização de containers.

A primeira execução completa encontrou uma falha no teste preexistente de homologação por `AMBIENTE=homologacao` herdado pelo comando; a repetição removeu essa variável. Uma execução intermediária de tipos leu arquivos enquanto o reforço do teste estava sendo salvo; o check final foi iniciado após o término das edições e passou. O script de recuperação também foi retomado após erros de codificação do psql/saída no Windows, sem apagar bancos ou sobrescrever o backup. As evidências finais confirmam a recuperação.

## Limites e pendências

- Conferência visual e HTTP ao vivo. Os testes de rotas chamam handlers diretamente; não são testes no navegador.
- Inicialização real do Docker Compose de homologação. Docker não está disponível neste ambiente; o YAML e as sobreposições foram conferidos com parser.
- Conexões reais: credenciais Meta no servidor, escolha do provedor de mídia e conectores de e-mail, redes sociais e pesquisa. O planejador de anúncios ainda não está conectado à interface.
- Publicação e validação em produção. Exigem conferência da versão instalada e backup com restauração da produção; o ensaio desta revisão usou somente dados sintéticos.

A revisão automática de aprovação bloqueou anteriormente o início do servidor local, retornando apenas “blocked by policy”, sem motivo detalhado. Por isso a conferência visual/HTTP permanece pendente; o bloqueio não foi contornado.

Timeout ou interrupção sem resposta do provedor pode deixar consumo desconhecido. O limite diário conta execuções; não é teto de gasto em reais. Aprovar o resultado autoriza tarefas internas, não mídia, veiculação ou orçamento. Não há transporte externo exposto ao modelo.

## Evidências da rodada

Os logs da execução ficam no diretório de trabalho da revisão e são reunidos no artefato `central-agentes-black-testes-revisao.txt`. O relatório de recuperação contém hashes dos backups e das linhas restauradas. O pacote revisado inclui manifesto SHA-256 e patch conferido contra a base em índice temporário; não altera o índice Git principal.
