# Recrutamento Black — entrega 1

## Escopo

Banco de talentos no BarberOS existente, sem duplicar clientes/usuários/funcionários. A gestão cria a vaga em rascunho, completa condições e aviso sobre os dados, abre inscrições, compartilha o formulário e acompanha candidaturas com análises e histórico.

- Painel: `/recrutamento`, dono e gerente; também há atalho no RH.
- Formulário público: `/vagas/[vagaId]`, somente com inscrições abertas.
- Campos: nome, WhatsApp declarado, cidade, experiência em meses, serviços, disponibilidade, portfólio e Instagram profissional opcionais.
- UTMs declaradas, versão do formulário e cópia do aviso ficam na candidatura.
- Ciência da finalidade e autorização para futuras oportunidades são separadas.
- A gestão move as etapas. Banco futuro exige autorização da pessoa. Não há rejeição ou contratação automática.
- Lista paginada por chegada (mais recentes primeiro). Não existe pontuação, inferência de personalidade ou análise automática de Instagram.

## Integridade e acesso

A API revalida o usuário ativo e restringe a gestão. As respostas internas usam `no-store`; a resposta pública confirma recebimento sem expor dados de candidatos. Limite de corpo de 20 KB e limite em memória por IP reaproveitam a infraestrutura atual (rate limit compartilhado será necessário se houver múltiplas instâncias).

Uma chave de envio com o mesmo conteúdo é idempotente. A mesma chave com outro conteúdo é recusada. A transação serializável grava pessoa, candidatura e auditoria juntas. Pessoas não são combinadas por telefone declarado. Etapas têm versão para detectar atualização simultânea; a análise profissional fica no histórico privado, sem replicar respostas no log genérico.

A migração `20261024180000_recrutamento` adiciona quatro tabelas e seus índices/relações. Não altera os registros operacionais existentes.

## Recuperação e conciliação em 24/10/2026

A sessão Linux original foi recuperada. Criada uma worktree separada, `feat/recrutamento-integrado`, a partir de `origin/codex/operacao-visual-checklist` (`181ef01`), incorporando `origin/main` (`27b0ac0`) por merge local. A fonte anterior permaneceu intacta.

Cultura Black e acabamento Motion foram recuperados dos arquivos e dos scripts de implantação anteriores. O hash conjunto de layout, navegação, dashboard, CSS, package.json, lockfile e componente de animação coincidiu com a homologação: `8ced00fbd5f2c2b93f5926050d5a23778801488e6847af907bc9e8f341fd75f7`. Isso preserva caixa, financeiro pessoal, campanhas da equipe, Cultura Black e o visual publicado.

O módulo de recrutamento da sessão Windows indisponível foi recomposto nesta base a partir da implementação registrada na conversa. Não há novas dependências.

## Verificação

- 321 testes unitários passaram, incluindo 30 testes novos de recrutamento.
- Lint, TypeScript e build Next/Turbopack passaram no Linux.
- `scripts/teste-recrutamento.mjs` é um teste HTTP com PostgreSQL real. Só executa quando `AMBIENTE=homologacao`, `RECRUTAMENTO_TESTE_ISOLADO=1`, host do banco `recrutamento-test-db` e database `recrutamento_teste`.
- Esse teste cria apenas pessoas fictícias no banco isolado e verifica papéis, vaga fechada/aberta, formulário, gravação, reenvio, concorrência, consentimento, histórico, atribuição e fechamento.

## Implantação e reversão

Destino autorizado: homologação, `/opt/barberos-homolog`. Produção não é alvo desta entrega. Antes da alteração, salvaram-se dump do banco de homologação, fonte e imagem anterior em `backups/recrutamento-20261024` e tag `barberos-homolog:recrutamento-before-20261024`.

A imagem nova é construída antes de trocar o container; o teste isolado deve passar antes da atualização. O compose mantém o projeto `barberos-homolog`, a rede e o banco existentes. A migração é aditiva; a imagem anterior pode ser recolocada sem remover as novas tabelas. Não executar rollback destrutivo do banco nem remover dados de candidatos.

A revisão automática inicialmente bloqueou a checagem de push por exigir autorização específica. Em seguida, Ygor autorizou explicitamente o envio da branch para luiscompanhoni/barberos e a conclusão do merge remoto. O código enviado pelo conector do GitHub deve ter a mesma árvore de arquivos validada localmente.

## Uso e fases seguintes

Antes de abrir uma seleção real, completar requisitos, condições, prazo de conservação e canal para pedidos sobre dados. Não foi criada vaga real nem campanha. Ainda não há interface de exclusão ou rotina de expurgo.

Ordem do plano: (1) banco/formulário/pipeline; (2) campanhas e atribuição Meta, com conta e orçamento explicitamente definidos; (3) Higgsfield para imagem/vídeo, verificando acesso à API e limites de créditos. O editor será avaliado nessa fase; nenhuma biblioteca de edição foi instalada.

Definir rubrica objetiva e validar critérios com Ygor antes de criar ranking. Instagram é portfólio opcional; seguidores, aparência e atributos sensíveis não são critérios. Entrevista, teste e decisão permanecem humanos.

## Resultado da implantação

Em 24/10/2026, a imagem `barberos-recrutamento:20261024` foi construída no VPS, validada num PostgreSQL separado e colocada no compose da homologação. O teste de integração passou nas 20 verificações e `prisma migrate diff` não detectou diferenças no banco limpo. A homologação retornou `running healthy`, `AMBIENTE=homologacao`, zero vagas/candidaturas (nenhum cadastro fictício foi inserido nela) e HTTP 401 na API privada sem sessão. Os containers de teste foram parados, sem apagar dados.

A abertura da rota no navegador de conferência foi bloqueada por `ERR_INVALID_AUTH_CREDENTIALS`; não houve validação visual autenticada nem tentativa de contornar essa autenticação. O acesso do usuário continua pela homologação, menu Equipe e ajustes → Recrutamento. Produção permaneceu no container anterior.


## Formulários profissionais e avaliação interna — 02/11/2026

Implementação local, ainda sem publicação. A aba **Formulários e critérios** permite criar modelos por função (barbeiro, recepção e auxiliar), editar perguntas e seções, ordenar, configurar escolha única/múltipla, texto e link, definir perguntas obrigatórias e condições baseadas em uma escolha única anterior. Limite técnico: 100 perguntas e 30 competências por versão; não há regra de cinco perguntas. Os modelos iniciais têm 14 perguntas profissionais, além dos campos comuns de candidatura já existentes. A gestão deve revisar as rubricas antes de aprovar.

A gestão define competências, perguntas que fornecem evidência, quatro âncoras observáveis (0–3), pesos que somam 100% e competências críticas. O candidato não recebe critérios, pesos, rubricas, nota ou ranking na resposta pública ou nos props da página. Respostas abertas exigem avaliação humana; autodeclaração não comprova execução. Ausência de evidência permanece pendente, distinta de nível zero.

Cada versão tem um ID próprio. Salvar mantém rascunho; aprovar torna o conteúdo imutável; duplicar cria novo rascunho com origem identificada. A aprovação não abre inscrições. A vaga fechada pode escolher uma versão aprovada. Arquivar exige encerrar inscrições que usem a versão; para recuperar uma versão arquivada, duplicar, revisar e aprovar a cópia. Não existe exclusão de versões pelo editor.

A candidatura congela definição privada, respostas, ID da versão e aviso. Alterar a vaga não reescreve candidaturas anteriores. Registros legados permanecem sem snapshot e sem pontuação retroativa; continuam no acompanhamento existente. Recepção e auxiliares não precisam selecionar serviços de barbeiro nos novos formulários.

A avaliação privada tem registros independentes para FORMULARIO, ENTREVISTA e PRATICA, com níveis, evidências, autor e horário. Nota = 10 × soma(peso × nível/3) / 100; somente após todos os critérios terem nível e evidência. O histórico é acrescentado, não sobrescrito. A avaliação usa a versão de concorrência da candidatura, não altera sua etapa e não decide contratação. Competências críticas abaixo de autonomia ficam destacadas mesmo com média alta. O painel mostra até 50 avaliações recentes; as anteriores continuam persistidas.

A migração `20261102180000_recrutamento_formularios` é aditiva: duas tabelas e três colunas opcionais. Não reclassifica candidatos, não modifica financeiro e não executa efeitos externos. Serviços de criação/edição/avaliação revalidam usuário ativo DONO/GERENTE; as rotas também exigem sessão. A auditoria não replica respostas ou justificativas profissionais. O limite do corpo público passa a 400.000 bytes para comportar formulários variáveis, mantendo limite de campos, rate limit, isca e idempotência existentes.

Comando de integração: `npm run teste:recrutamento:formularios`, exclusivamente com `DATABASE_URL` apontando para `barberos_recrutamento_formularios_teste` em `127.0.0.1:55439`. O script bloqueia rede externa e usa apenas fixtures. O banco deve estar migrado e ser descartável. Os dumps e a restauração desta entrega são locais; não representam backup de produção.

A base aprovada `src/lib/agentes/conhecimento-black.ts` entra como fonte explícita em `contextoAgente`. Contém condições declaradas, pendências e limites, sem candidatos ou resultados fictícios. Não chama modelo pago, não modifica flags de execução e não aprende automaticamente: novos aprendizados requerem evidência e nova versão revisada. A cópia para consulta do dono fica em `outputs/base-conhecimento-black` no workspace da tarefa.

Continuam pendentes: conferência visual no navegador (inicialização local bloqueada pela revisão automática), piloto com avaliadores, agendamento próprio de entrevistas/bot e eventual publicação com backup e recuperação validados em produção. A implementação não usa agenda de serviços para entrevistas.


### Revisão em quatro ciclos — 02/11/2026

Os modelos novos de barbeiro separam a experiência declarada nos cinco serviços em escolhas descritivas. Recepção/auxiliar continuam com 14 perguntas profissionais; barbeiro passa a 18. As rubricas iniciais agora descrevem evidências de cada competência. Isso só altera o ponto de partida de novos rascunhos: versões persistidas e candidaturas permanecem intactas e exigem cópia/revisão para evoluir.

A migração aditiva `20261102190000_recrutamento_revisao` inclui versão otimista na vaga. Toda edição/abertura/encerramento exige a versão atual, evitando conferir um formulário e abrir outro em corrida. Clientes antigos recebem erro de validação ao editar sem versão; devem recarregar a interface nova. Nenhum vínculo existente é removido por omissão de formularioId em uma edição. A auditoria de recebimento usa o identificador real da versão aplicada.

Novos hashes são canônicos quanto à ordem de chaves e escolhas múltiplas. O reenvio original de um registro criado antes da revisão continua reconhecido pelo hash legado; não se regrava o histórico. Mesmo telefone declarado na mesma vaga continua bloqueado como candidatura repetida, sem fundir pessoas entre vagas. Isso não verifica identidade.

Editor e avaliação avisam antes de descartar rascunhos em suas operações. O editor também protege recarga, links e troca de aba. Escolhas múltiplas obrigatórias têm validação nativa; IDs de ajuda são exclusivos por instância. A mudança de etapa do candidato mantém o componente de avaliação, preservando a mensagem de confirmação.

A migração `20261102200000_recrutamento_contexto` adiciona `vagaSnapshot` opcional. Novas candidaturas guardam título, cidade, condições, função e título do formulário no mesmo recebimento. A tela usa o título congelado e mostra as condições originais; registros anteriores sem snapshot são identificados como sem cópia histórica. Nenhuma condição é reconstruída ou preenchida retroativamente.
