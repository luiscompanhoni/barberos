# Central de agentes da Black

Escopo desta entrega: processos da barbearia Black Barber. A comercialização do BarberOS fica fora desta fase.
A central reúne 22 especialidades: as 20 solicitadas, estratégia de campanhas e gestão de tráfego.
O catálogo fica em `src/lib/agentes/catalogo.ts`; cada perfil declara objetivo, fontes, instruções e destinos permitidos.

## O que funciona

- Tarefas persistentes, resultados estruturados, origem das informações, revisão, cancelamento e repetição explícita.
- Rotinas por intervalo, desativadas por padrão, com fila persistente e recuperação após reinício do servidor.
- Contexto por especialidade com dados agregados da agenda, clientes, financeiro, equipe, campanhas e recrutamento.
- Execução usando o cliente e modelo Anthropic já existentes. Novas execuções exigem habilitação explícita.
- Dados pode sugerir uma tarefa para Estratégia; Estratégia pode encaminhar Conteúdo. O servidor limita esse caminho automático a duas etapas. Não é um ciclo ilimitado.
- Conteúdo só encaminha Tráfego depois da revisão humana do resultado correspondente. Aprovar um resultado não autoriza publicação nem orçamento.
- Adaptador Meta Ads de leitura com paginação restrita, deduplicação por anúncio/dia, valores em centavos e origem da atribuição.

As especialidades produzem análises, roteiros, textos, planos e tarefas internas. Não são 22 contas de IA independentes.
Não há envio de e-mail/WhatsApp, publicação social, anúncio, cobrança, estorno ou alteração de código pelo executor da central.
Os fluxos operacionais preexistentes continuam com suas próprias regras.

## Conexões pendentes

| Capacidade | Situação |
|---|---|
| Modelo de texto existente | Reutilizado; execução da central começa desligada. |
| Meta Ads | Leitura implementada e testada com respostas sintéticas; exige token, versão e conta no servidor. Sessão no navegador não é autorização de API. |
| Imagens e vídeos por IA | Fornecedor ainda não escolhido. O perfil Conteúdo prepara roteiro/direção criativa. Não gera o arquivo de mídia. |
| Black Estúdio | Contexto consulta metadados dos projetos do responsável. Não cria automaticamente projetos nem vincula a aprovação do texto à aprovação de um arquivo. |
| E-mail, redes sociais e pesquisa web | Sem conectores de execução nesta central. |
| Programação | Prepara especificações; sem acesso ao repositório, execução de código ou deploy. |
| Otimização de anúncios | Funções determinísticas de avaliação e plano pausado estão implementadas/testadas; ainda não conectadas à interface nem ao executor. Exigem metas e política de orçamento definidas. |

## Ativação e operação

1. Publicar somente mediante pedido, conferindo a versão instalada, backup completo e restauração em ambiente isolado antes da migração.
2. Aplicar `20261102030000_central_agentes` pelo fluxo normal de deploy. A migração cria três tabelas; não reescreve dados financeiros, clientes ou cobranças.
3. Configurar `AGENTES_HABILITADOS=true` para mostrar `/agentes` ao dono. A fila pode ser preparada com execução desligada.
4. Autorizar o uso de IA e configurar `AGENTES_EXECUCAO_ATIVA=true` com a credencial Anthropic já existente. O modelo principal não foi trocado.
5. Começar com poucas tarefas, conferir resultados e então ativar as rotinas desejadas. O temporizador do servidor verifica a fila a cada minuto.
6. Para leitura Meta, configurar `META_ADS_API_VERSION`, `META_ADS_ACCOUNT_ID` (`act_...`) e `META_ADS_TOKEN` somente no servidor. Nunca copiar cookies do navegador. Validar a conta, permissões de leitura, moeda e fuso em homologação.

O limite diário é uma contagem de execuções iniciadas nas últimas 24 horas, não um teto em reais.
Padrão: 20; máximo configurável: 200. Há uma execução simultânea no banco, no máximo 100 trabalhos abertos e profundidade total de quatro encaminhamentos.
O modelo recebe até 100 KB de contexto e produz até 6.000 tokens por chamada. Não há retry automático do provedor.
Pausar impede novas chamadas e encaminhamentos automáticos; uma chamada já aceita pode terminar e consumir tokens.
Cancelar impede a aceitação de conteúdo novo e novos encaminhamentos daquela execução. Tarefas derivadas já criadas continuam independentes; a confirmação orienta cancelá-las separadamente.
Consumo recebido depois do cancelamento, de resposta inválida ou truncada é registrado sem guardar o conteúdo rejeitado.
Timeout/interrupção pode deixar consumo desconhecido; conferir o provedor antes de repetir.
Repetir preserva o briefing de origem e o vínculo com a rotina. Uma mesma falha não cria duas repetições abertas;
se a rotina já tiver trabalho de outro período em aberto, a repetição antiga é recusada.
Fila cheia adia novas rotinas, mas permite processar os trabalhos existentes. A aprovação usa a vaga liberada pelo próprio trabalho;
se não couberem todos os encaminhamentos, a transação desfaz a aprovação, os filhos e a auditoria dessa tentativa.

O compose de homologação força a execução dos agentes desligada e o token Meta vazio, mesmo quando o `.env` tiver valores de produção.
Testes com modelo falso usam injeção de dependência; não é necessário habilitar credenciais reais para validar a central.

## Permissão, concorrência e auditoria

Somente dono ativo acessa a central. A autorização é relida no servidor, inclusive antes da execução e ao aceitar o resultado.
Mutação verifica origem, entrada estrita e revisão. Criação usa chave de idempotência e hash do conteúdo; reutilizar a chave com outro conteúdo é erro.
O hash de resultado é canônico, independente da ordem de propriedades do JSONB do PostgreSQL.
Aprovação confere revisão/hash exatos e cria encaminhamentos na mesma transação. Reenvio da aprovação não duplica filhos.
Transações curtas usam trava PostgreSQL; contexto e chamada ao modelo ficam fora delas. A reserva vence em 15 minutos e não é retomada automaticamente.
Auditoria e alterações ficam na mesma transação. Resultados são texto; não executam ferramentas, código nem comandos sugeridos pelo modelo.
O contexto evita listas de contato e rankings nominais de clientes. Resultados e fontes permanecem privados ao dono solicitante.
Campanhas internas identificam o canal WhatsApp e medem o limite em mensagens, sem confundi-lo com orçamento de anúncios.
O painel prioriza todos os trabalhos em aberto e completa até 100 registros com histórico recente, usando uma leitura consistente.
A interface limpa os dados ao receber 401/403 e invalida respostas anteriores ainda pendentes.

## Validação e recuperação

`npm run check` valida lint, regras, tipos, unitários e build. `npm run teste:agentes` exige exclusivamente
`barberos_agentes_teste` em localhost/127.0.0.1, previamente migrado. Usa modelo e fontes falsos, com rede externa bloqueada.
O runner de todos os fluxos usa `DATABASE_URL_AGENTES` separado do banco comum; o CI prepara esse banco.

O teste de fluxo cobre permissão, criação concorrente, reserva única, hash/aprovação, encaminhamento, cancelamento durante chamada,
pausa, limite diário, revogação, rotina atrasada, fila cheia, rollback, repetição e preservação integral de registros financeiros sintéticos.
Os testes de rota chamam os handlers diretamente; não substituem HTTP ao vivo ou navegação.
Os testes Meta cobrem dados repetidos/divergentes,
paginação, credenciais, erro, limites, datas, valores e atribuição; não comprovam uma conexão real.

Para reverter a ativação, desligar `AGENTES_EXECUCAO_ATIVA` e `AGENTES_HABILITADOS` e reiniciar o servidor.
Preservar as novas tabelas e auditoria; não executar DROP como rollback. Um retorno ao código anterior deve manter a migração aditiva.
Recuperação de banco exige restaurar o backup completo em destino isolado, conferir contagens e versão, e planejar o corte para não perder operações posteriores.
Esta entrega local não constitui backup nem restauração da produção.
Os quatro ciclos de revisão e suas evidências estão em [revisao-central-agentes-2026-11-01.md](revisao-central-agentes-2026-11-01.md).
