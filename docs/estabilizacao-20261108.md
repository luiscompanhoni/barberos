# Estabilização após auditoria — 8 de novembro de 2026

As correções foram preparadas na cópia local `work/barberos-estabilizacao-20261108`, branch `correcao-auditoria-20261108`, derivada de `8a5566dc6c095090f23dbb72384c92b4e79de81c`. A revisão anterior `6551206` passou no CI Linux #99: 1.744 unitários, 55 cenários PostgreSQL sem skips, os 24 fluxos, build, imagens, renders e recuperação sintética. A continuação acrescenta o rateio de centavos aprovado, a proteção contra comissões sem destinatário e sua integração com Reuniões. Os resultados do CI devem sempre ser associados ao SHA exato do PR; o CI anterior não certifica alterações posteriores.

O dono autorizou branch de revisão, PR em rascunho e CI Linux com dados fictícios, sem merge, deploy ou gastos adicionais. Este registro não certifica o sistema como completo ou livre de falhas.

O trabalho preserva o histórico, separa valores cobrados de recebimentos comprovados e mantém a aprovação humana. Nenhuma publicação, transferência, cobrança externa, campanha, envio ou ativação de IA paga foi executada nesta estabilização. As migrations foram aplicadas somente a bancos locais descartáveis com dados fictícios.

## Correções por área

| Área | Implementação local | Limite atual |
| --- | --- | --- |
| Recebimentos e conciliação | Provas por gateway, valor e data recebidos; divergências em revisão; importação Stone estrita e auditada; despesas vinculadas pelo dono sem deduplicação automática por valor/data. | O método histórico da Celcash por data do status precisa de ponte documental com a nova base. Valores e salários reais não estão homologados por estes testes. |
| Comissões e folha | Retrato congelado, identidade do profissional preservada, regras/salários por competência, índice único para regra geral, maiores restos versionados e diagnóstico auditável. Produção sem destinatário e divergências de rateio impedem fechamento/CSV incompletos. Reuniões recebe apenas uma pendência genérica. | Regras de adicionais incompatíveis com o rateio ficam em revisão. Estorno posterior ao fechamento, dados reais e fechamento efetivo ainda precisam de homologação. |
| Agenda e recepção | Novos adicionais reservam tempo/cadeira, iniciam marcados e exigem conclusão própria; idempotência evita repetição após timeout; cancelar comanda não ressuscita adicional; entrevista consulta a agenda do dono. | Sem ocupação retroativa automática do legado. Reagendar/transferir grupos com adicionais exige revisão orientada. |
| Avaliações e jogos | Amostras privadas pequenas formam lotes entre competências; bônus mostrado corresponde ao jogo escolhido; legado publicado preservado. | A avaliação mensal após pagamento continua infraestrutura interna sem fluxo completo nem anonimato comprovado. Campanhas de serviços ainda não liberam giros. |
| Acesso e dados | Contadores concorrentes, revogação de sessões, limites de entrada, CSV protegido e Pix cifrado/mascarado com autorização e auditoria. Fixture pública sintética. | A chave operacional de cifra precisa ser instalada e homologada. Contenção do histórico remoto com dados pessoais pendente. Pagamento Pix real permanece sem liberação. |
| Publicação e recuperação | Isolamento dos escritores, bloqueios preservados no retorno anterior à migração, quarentena após falha, manifesto de tabelas/schema e reserva de disco proporcional. | A prova PostgreSQL local não substitui CI Linux, Docker, mídias, cifra, bucket ou restauração real da VPS. Não autoriza publicar automaticamente. |

Os 24 achados originais estão discriminados em `outputs/estabilizacao-2026-11-08/matriz-correcoes.md`, na raiz real do workspace. DEP-01 e GAP-01 a GAP-05 ficam fora dessa contagem, separando vulnerabilidades, regressões e funcionalidades incompletas.

## Evidências da preparação anterior

| Camada | Resultado conhecido | Alcance |
| --- | --- | --- |
| PostgreSQL direcionado, execução final `1794116083283` | **Todos aprovados:** acesso 8, Pix 10, vigências 9, agenda 14, despesas 12, financeiro 18 e fluxo de avaliações. Financeiro inclui novas disputas determinísticas de exclusão, mudança de regra, pagamento e reabertura. | Bancos separados, fictícios e descartáveis em `127.0.0.1:55439`; não homologa valores ou salários reais. Corrida descoberta em rodada anterior foi corrigida antes desta repetição. |
| Horários | **11/11 cenários PostgreSQL aprovados**, em `horarios-final.log/json`. | Completa as disputas locais de horários/campanhas; não ativa agenda de produção. |
| Histórico | 66 unitários aprovados na revisão final específica. | Provas, origem e preservação dos vínculos; não confere pagamentos reais. |
| Regressão ampla, execução `1794113822505` | Fluxos locais de assinaturas, pagamentos simulados, comandas, automações, jogos, financeiro, histórico, agentes, templates, RH, despesas, checkout, estorno, permissões, cancelamento, LGPD e recrutamento passaram. Evolução exigiu correção/repetição. | APIs externas bloqueadas ou falsas. Não equivale à integração bancária real. |
| Repetição selecionada, execução `1794116221064` | **8/8 aprovados:** histórico, RH, comandas, financeiro, despesas, campanhas, cancelamento e evolução. Evolução concluiu seus oito submódulos. | Repetição cobre o código de produto final; não representa execução remota do CI Linux. |
| Backup PostgreSQL, execução `1794113822505` | Restauração sintética: 82 migrations, 122 tabelas, linhas/SHA-256, sete grupos de schema, sequências, escritor concorrente e controles negativos aprovados. | Dump custom e restore locais. Não testa contêiner, gzip operacional, mídias, cifra, bucket ou produção. |
| Python operacional | Última execução `python-final-com-bash.log`: **74 testes, 68 aprovados e 6 com erro** no Windows: quatro por `O_NOFOLLOW` e dois por privilégio de symlink. Git Bash já instalado foi incluído no PATH e seu caso passou. | Os seis restantes exigem Linux; não foram convertidos em aprovados. |
| UI local fictícia | Login, painel, cadastro de funcionários do RH e financeiro conferidos pela coordenação; capturas `ui-rh-ficticio.jpg` e `ui-financeiro-ficticio.jpg`. Fontes Google bloqueadas pelo isolamento usam fallback. | Não equivale a homologação de todas as telas, acessibilidade integral ou fluxo de produção. |
| Check final | **`npm run check` aprovado**, execução `1794116127636`, código 0: ESLint, regras de qualidade, tipos, Vitest e build. Vitest: **1.743 aprovados, 55 pulados; 205 arquivos aprovados, 5 pulados**. Os 55 casos dependentes de PG foram executados separadamente e passaram: agenda 14, despesas 12, financeiro 14, adicionais 4 e horários 11. | São execuções distintas, sem somar de novo aos cenários direcionados. Não equivale a CI Linux ou imagem Docker publicada. |
| Orquestração CI após o check | **3/3 contratos Bash aprovados** do roteador RH/comandas, sem fallback genérico. Workflow prepara seis bancos efêmeros com owner role LOGIN sem privilégios globais: migração/seed dos dois fluxos e somente migração das quatro bases de estabilização. Os **55 casos PG opt-in** estão ligados, além dos roteiros de acesso, Pix e vigências. YAML, **26/26 sintaxes Bash e 4/4 contratos anti-skip/cobertura aprovados** localmente. Token somente de leitura; sem gravação de cache ou upload de artifacts. | Ajustes de orquestração limitados ao workflow/Bash; nenhuma execução local de PostgreSQL, npm real ou Docker nesta validação estática. Branch, PR em rascunho e CI sem gastos foram autorizados; aprovação remota depende da execução acompanhada pela coordenação. |
| Dependências | Relatórios `npm-audit-app-corrigido.json` e `npm-audit-cli.json` com **zero vulnerabilidades reportadas**; dependências não mudaram depois deles. | Audit cobre dependências conhecidas consultadas, sem certificar segurança do código, infraestrutura ou cadeia de fornecimento. |

Não somar contagens de rodadas diferentes: elas repetem cenários. Logs preservam tentativas anteriores e correções das fixtures; arquivo de teste existente ou teste pulado não comprova aprovação.

## Decisões e passos ainda necessários

1. Conferir o manifesto e o CI Linux do SHA atual do PR em rascunho. A autorização de branch/PR/CI já foi concedida. A aprovação da revisão anterior não substitui essa repetição nem o procedimento de publicação do ambiente real.
2. Homologar vínculos por IDs e aplicar os valores já confirmados no registro privado de remuneração, mantido fora do Git, com vigência de novembro. Baseline legado não prova salário histórico. Comparar o próximo fechamento com o método antigo antes de lote bancário.
3. A política de maiores restos foi aprovada e implementada por vigência; a migração conserva `LEGADO`. Escolher a competência na homologação real e resolver exceções de adicionais. Estornos posteriores à folha fechada continuam dependendo de decisão, sem dedução retroativa presumida.
4. Concluir a ponte Celcash: relatório privado por data do status, substatus, IDs e hash; comparar com recebimentos comprovados e liquidação. Não tratar o total mensal informado pelo dono como líquido sem evidência.
5. Executar contenção remota dos dados pessoais com plano e aprovação próprios; substituir fixture local não apaga commits, caches ou clones.
6. Homologar no Linux backup/restore e imagem de publicação, incluindo mídias, cifra, destino externo e espaço. Validar restauração do backup da instalação antes de migração futura.
7. Desenvolver a segunda fase funcional da matriz: avaliação mensal, giro por serviços e estados reais dos conectores. Manter preparações e integrações ausentes declaradas na interface.

O [runbook de recuperação](recuperacao-segura.md), a [homologação de recebimentos](homologacao-recebimentos.md), as [vigências da remuneração](remuneracao-vigencias.md) e relatórios por frente complementam este registro. Publicação e efeitos externos exigem etapa posterior, evidência do ambiente correspondente e decisão humana.

## Continuação: rateio e destinatários

`npm run check` passou na execução local `1794122678469`: 1.781 unitários em 208 arquivos, lint, regras de qualidade, tipos e build. Os 61 casos PostgreSQL opt-in ficaram fora desse comando; seis novos de vínculos/vigência e os 18 financeiros anteriores passaram separadamente na execução `1794122410826`, em bancos novos. Os 37 novos unitários incluem 2.268 combinações pequenas dentro de um único teste de propriedades, sem inflar a contagem de casos.

A migração `20261108020000_pote_arredondamento_versionado` é a 83ª e não ativa maiores restos. O schema real migrado ficou sem diferenças para o Prisma. A prova de backup local repetida com as 83 migrations conservou 122 tabelas, hashes, sequências e imutabilidade, com controles negativos. O comparador estrutural inclui os valores ordenados dos enums e o harness exige rejeitar um label não default adulterado com a tabela vazia. A prova sintética não é um backup nem uma restauração de produção.

O [guia do rateio](rateio-assinaturas.md) descreve o método, desempate, adicionais, valores não rateados e bloqueios. Dados de profissionais reais e a homologação da folha ficam em artefatos privados fora do repositório público. A leitura de produção não aplicou associações, salários ou correções contábeis.

O CI Linux #100, de `c6e9908`, aprovou os 1.781 unitários, 61 cenários PostgreSQL sem skips, 84 testes Python e as 83 migrations, mas encontrou duas falhas antes de aprovar a revisão inteira: a fixture de desempenho criava barbeiros sem cadeira vinculada e a imagem falhou no carregamento de Google Fonts pelo Turbopack. A fixture foi corrigida preservando a guarda financeira e passou separadamente no PostgreSQL local. As mesmas famílias tipográficas passaram a usar [arquivos oficiais locais com licença e origem preservadas](fontes-locais.md), sem alterar dependências ou desabilitar TLS.

A repetição completa `1794124534731` de `npm run check` passou com rede externa bloqueada, incluindo build com as fontes locais. A prova final `1794123172269` do backup também passou: 83 migrations, 122 tabelas, oito grupos estruturais, snapshot concorrente, sequências e quatro controles negativos, incluindo enum adulterado com tabela vazia. O resultado Linux da revisão final deve ser conferido no SHA do PR; o CI #100, isoladamente, não foi uma aprovação final.
