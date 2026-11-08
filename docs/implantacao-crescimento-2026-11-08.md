# Crescimento e migração — entrega local de 08/11/2026

## Estado verificável

Implementação no código local, sem commit, publicação, migração de banco de produção, ativação de campanha, cobrança nova real ou gasto de mídia. A configuração de produção e a restauração de backup não foram homologadas nesta entrega. O acesso aos painéis foi retomado apenas para leitura.

Entregas navegáveis depois da publicação:

- `/migracao-assinaturas`: inventário local paginado, controle por contrato, responsável, versão e evidências gerenciais. Uma conclusão manual não é certificação automática do provedor. A tela não envia mensagens nem cancela o legado.
- `/crescimento`: metas de 400 assinantes adimplentes, R$ 70 mil de receita em dezembro e 35% de margem líquida; separa fotografia nominal, adimplência local e projeção. Sem custos completos/capacidade/contribuição conferidos, não libera sugestão de verba. Mesmo com evidências, o resultado não aprova gastos automaticamente.
- `/calendario-conteudo`: preparação interna em 08/11 e 22 roteiros completos de 09 a 30/11, com filtros e detalhes. Texto estático sincronizado manualmente com o documento; nada gravado, agendado ou publicado. Peças de indicação dependem da homologação e ativação.
- Carteira do cliente: solicitação explícita de crédito de indicação em mensalidade, total ou parcial, com extrato de reservas. Uma reserva não comprova pagamento.
- Campanhas: grupos quente até 30 dias, morno 31–90, frio 91–365 e muito frio acima de 365; ausência de visita e histórico incompleto têm estados separados. Migração em aberto bloqueia campanha concorrente; contatos de campanha têm intervalo mínimo de 48 horas e releitura antes do envio.
- Agentes existentes: contexto de metas, condições comerciais e limites de execução anexado aos agentes de crescimento, assistente e dados. O agente de tráfego prepara decisões; não ganhou publicação de anúncios nesta entrega.

## Conferência ao vivo em 08/11

Fontes: telas autenticadas `painel.cashbarber.com.br/contratos-ativos` e `painel.appblackbarber.com/assinaturas`. A tabela do Cash Barber foi consultada sem filtro; contagem DOM das 251 linhas e valores conferida com os totalizadores da tela. São valores de contratos, não receita recebida.

| Medida | Cash Barber | BarberOS |
|---|---:|---:|
| Contratos no resumo vigente | 251 | 271 ativos, incluindo atrasados |
| Em atraso | 49 | 38 |
| Regulares/sem marca de atraso | 202 regulares | 233 por diferença; pagamento não comprovado |
| Mensalidades nominais | R$ 30.606,00 | R$ 34.298,00 |

Cash Barber: 249 contratos Cel Cash (R$ 30.370) e dois manuais (R$ 236). Os 202 regulares somam R$ 24.564; os 49 atrasados, R$ 6.042. Corte tem 210 contratos, corte e barba 40 e barba um. Os preços por cliente variam; preservar contratos e condições antigos, sem substituir todos pelo catálogo atual.

O resumo operacional do Cash Barber informa corte dos dados até 07/11 às 23h59. Seu faturamento comparativo do mês passado aparece como R$ 30.091,02, diferente da consulta financeira anterior de outubro (R$ 35.293,55). Definição, filtro e conciliação precisam ser conferidos; nenhum desses números substitui uma DRE reconciliada.

O BarberOS carrega 200 linhas nessa listagem. O cruzamento inicial dessas linhas com os 251 contratos legados encontrou 165 nomes exatos normalizados e 86 sem correspondência exata nessa amostra. **Isso não significa 86 clientes ausentes**: cobertura parcial, grafias diferentes e homônimos impedem usar nome como identidade. Não houve mudança de status ou valor a partir desse cruzamento. O painel também registra 21 casos históricos de pagamento Celcash sem assinatura vinculada e alerta que a agenda ainda depende de confirmação no Cash Barber.

Próxima conciliação: exportação íntegra dos clientes/contratos/recebimentos/agendamentos, identidade por IDs de origem e dados confirmados, revisão de ambiguidades, ciclo pago, valores individuais, saldo, cancelamentos e cobrança duplicada. Cartão, pagamento e consentimento não são comprovados por cadastro nominal.

Bloqueio de acesso observado ao encerrar: a aba Celcash/Cellpayments continua na tela “Apenas pessoas autorizadas, efetue login”, com campos vazios e reCAPTCHA. Foi solicitado login pelo próprio usuário, sem compartilhar senha/código. O acesso ao Cash Barber não autentica essa aba. A conferência dos recebimentos dessa conta aguarda esse acesso; não houve tentativa de preencher credenciais ou contornar o desafio.

## Indicação e crédito

V2: R$ 20 para indicador e R$ 10 para indicado, após pagamento consultado no gateway e revalidado localmente. Novos assinantes ou ex há pelo menos 90 dias sem plano, uma concessão por indicado; migrações rastreadas não geram indicação. Validade de 30 dias a partir da concessão, sem saque. Benefícios anteriores seguem `ATENDIMENTO_V1`.

O teto agregado inclui compromissos pendentes, não só benefícios resgatados. Não há orçamento V2 aprovado nesta configuração. O piloto de 20 pessoas/R$ 200 refere-se a brindes; não autoriza outros R$ 600 para 20 conversões de indicação.

Solicitação dentro da validade reserva crédito para uma próxima competência específica, mesmo com vencimento posterior. O valor reservado sai do disponível, mas só recebe data de uso definitivo após pagamento comprovado. Pix usa o restante da mensalidade; cartão exige desconto fixo de um ciclo confirmado no provedor. Quitação integral por crédito, conflitos, estorno, timeout ou prova incompleta vão para recepção, sem cobrança artificial, repetição cega, liberação ou prorrogação automática.

As provas rígidas dependem dos campos efetivamente retornados pela conta Pagar.me. Ausência de campo bloqueia ou deixa revisão. Testes com mocks não homologam o contrato da API nem uma cobrança real. A conversão V2 usa a rotina de crescimento existente; sua execução depende dos controles globais de automação/piloto. Homologar também esse agendamento e a notificação, sem presumir concessão imediata no webhook.

## Publicação e retorno seguro

1. Seguir [publicação e recuperação](publicacao-sem-terminal.md): identificar versão real instalada, acessos, configuração, divergências locais e imagem anterior; backup de banco/mídias e restauração isolada comprovada. Publicação continua dependente de pedido explícito.
2. Suspender os executores de crescimento/WhatsApp antes da troca, usando `WHATSAPP_ENVIOS_BLOQUEADOS=true` e parada dos cron/workers pertinentes. Conferir que nenhum processo antigo continue convertendo indicações.
3. Revisar e aplicar migrações de expansão pendentes, incluindo a restrição dos Business da etapa de atendimento e `20261108210000_crescimento_migracao`. Esta entrega gerou o Prisma Client e aplicou as 74 migrações em PostgreSQL descartável; não aplicou SQL em produção.
4. Atualizar todos os processos para a mesma versão; conferir saúde, autenticação, permissões, controles de campanha, inventário e carteira. Não misturar worker antigo com V2. Testar concorrência e recuperação em PostgreSQL descartável antes da produção.
5. Manter `INDICACAO_ASSINATURA_V2_ATIVA=false`, `INDICACAO_ASSINATURA_LIMITE_CENTAVOS=0` e `CREDITOS_MENSALIDADE_ATIVOS=false` até conciliação, orçamento e homologação do gerente. Validar sandbox, titular, moeda, valor líquido, fatura, desconto e webhook; não ativar gateway pago silenciosamente.
6. Preparar piloto 4 grupos × 5, custo real de brinde até R$ 200, agenda e estoque conferidos. Usar benefício real, identidade Black e recusa respeitada; promoção aleatória requer enquadramento prévio. Aprovar criativo, condições, destino e teto antes de enviar ou anunciar.

Rollback: manter tabelas/colunas e registros; não apagar reservas, benefícios ou vínculos. Desligar flags novas não desfaz desconto aplicado no provedor e não libera reserva. **Antes de voltar código antigo, manter executores de crescimento parados/bloqueados**: o conversor antigo desconhece `ASSINATURA_V2` e pode premiar por visita sob regra incorreta. Retomar somente em versão compatível e após reconciliação manual. Não restaurar banco sobre pagamentos posteriores.

## Verificações e limites

`npm run check` passou: ESLint, regras locais, tipos, 197 arquivos de teste aprovados (um ignorado), 1.786 testes aprovados (11 ignorados) e build de produção. `prisma validate` e `git diff --check` passaram. Foram cobertos regras, permissões, provas de pagamento, orçamento, idempotência, reservas, estornos, Pix residual, segmentação, cadência, calendário integral e projeções.

PostgreSQL 16 descartável em `127.0.0.1:16548/crescimento_validacao`, sem dados reais: 74 migrações aplicadas com sucesso. Ensaio `work/crescimento-2026-11-08/smoke-postgres.ts` confirmou duas solicitações concorrentes com uma reserva, duas assinaturas disputando o mesmo saldo sem gasto duplo, reserva parcial, conservação dos R$ 20 e distinção entre cobrança pendente e paga, além do default V1. Usou prova sintética explícita de pagamento e bloqueou chamadas de rede externas; não homologou gateway. Instância encerrada depois do ensaio; arquivos sintéticos preservados fora do repositório.

As novas referências das skills foram conferidas manualmente quanto aos links e frontmatter preservado; o validador Python oficial não foi executado. Ainda faltam atualização de banco/produção com restauração comprovada, ensaio HTTP/UI com sessão interna, dispositivos PWA e homologação de provedor/equipe. Conciliação de clientes permanece parcial e não autoriza disparos.

Revisão sugerida, não executada: cinco ciclos pelo risco financeiro e de contato com clientes. Prompt copiável: “Revise em 5 ciclos esta entrega: conciliação e identidade; indicação/carteira/concorrência; gateway e recuperação; campanhas/permissões/roteiros; integração e publicação/rollback. Registre achados e evidências, execute checks pertinentes e `npm run check` ao final. Não publique nem gere custos.”
