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
