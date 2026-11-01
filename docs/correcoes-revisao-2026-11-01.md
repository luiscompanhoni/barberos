# Correções após os três ciclos locais — 01/11/2026

O relatório do agente Windows identificou quatro achados operacionais e diferenças locais ainda não integradas. Esta rodada alterou somente a candidata na nuvem. Nenhum commit, push, deploy, alteração de credencial ou comando na VPS foi executado.

## Alterações e limites

| Achado | Tratamento nesta candidata | O que ainda falta |
|---|---|---|
| Backup sem mídias | Override monta mídia somente para leitura; dump restaurado determina referências; arquivo pareado com SHA-256; extração real e conferência de bytes/hash. Falha com mídia ausente, volume omitido, par errado ou espaço insuficiente. | Instalar somente após revisão; conferir capacidade e restauração da instalação real. |
| Deploy sem recuperação | Entrada de produção do script legado bloqueada antes de empacotar/conectar. Não há opção para ignorar o bloqueio. | Implementar e ensaiar substituição/recuperação com o inventário efetivo da VPS; o bloqueio não é rollback. |
| Temporários persistentes | `/worker/jobs` passa a tmpfs de 1 GiB em produção/homologação; descarte no reinício. Volume antigo não é apagado. | Render representativo e pior caso sob 2 GiB/0,75 CPU; tmpfs concorre com memória do processo. |
| Testes Windows | Teste SSH usa substituição da chamada ao processo, sem executável POSIX/PATH fixo. `-F none` funciona nos clientes suportados. Testes Node separados dos testes Python; CI de preparação exige Windows e Linux. | Rodar os testes Node no Windows real. Permissões NTFS, login SSH e CI remoto não foram comprovados aqui. |

Backups usam nomes únicos, trava contra concorrência e bancos temporários exclusivos. Restauração manual recusa um destino já existente. Falha não remove backups anteriores. Cópia externa, quando previamente configurada, precisa enviar os dois arquivos para indicar sucesso; nenhuma cópia externa foi ativada nesta rodada.

Os arquivos UUID são imutáveis. A seleção usa o estado do dump, não uma consulta posterior ao banco vivo. Se um usuário apagar uma mídia antes da cópia, o backup falha; não se declara uma cópia incompleta como restaurável. O manifesto vincula o arquivo de mídias ao SHA-256 do dump. Arquivos órfãos e uploads `.part` não são copiados como dados recuperáveis.

## Verificações executadas

- 11 testes Node portáveis e 13 testes Python aprovados no Linux. Incluem rejeição de links/travessia, mídia divergente, par de backup errado, preservação de destinos e sintaxe Python dos três modelos de diagnóstico.
- Imagem de backup construída com PostgreSQL 16, Python e ferramentas de backup. O executor exigiu proxy/DNS e CA de build; a CA entrou como segredo BuildKit, sem desabilitar TLS.
- Ensaio em container exclusivo, sem porta publicada, com dados fictícios: dump, restauração de banco, cópia/extração de mídia, comparação exata de bytes e registro de sucesso; segunda restauração recusada sem sobrescrever o destino.
- Ensaios negativos: mídia ausente e volume não configurado impediram sucesso; backup antigo e banco de teste preexistente foram preservados. Container e dados sintéticos do ensaio foram removidos ao terminar.
- tmpfs de 1 MiB no ensaio rejeitou escrita além do limite e ficou vazio após reinício. Isso valida o mecanismo de descarte/limite, não o render no limite de produção de 1 GiB.
- Composes renderizados com configuração sintética: montagem somente leitura no backup e tmpfs nos dois workers. YAML do workflow validado localmente; execução GitHub ainda pendente.
- Lint dos scripts Node, sintaxe Bash e `git diff --check HEAD` aprovados. Schema Prisma validado; nenhuma migração mudou nesta correção.

## Pendências recebidas do Windows

- `barberos`: 17 arquivos diferentes, 6 exclusivos e 6 idênticos à candidata.
- `barberos-estudio`: 9 de 38 caminhos diferentes.
- `barberos-integrado-studio`: 7 de 42 caminhos diferentes, com staging preservado.
- O inventário automático da VPS falhou com `Permission denied`. O login interativo anterior continua sendo uma evidência distinta; não pedir redefinição de senha ou novas chaves apenas para repetir o teste.

Essas contagens não incluem os patches nem demonstram quais diferenças devem entrar. O executor local deve comparar conteúdo, preservar buffers e integrar em uma cópia separada. A candidata da nuvem não incorpora essas alterações exclusivas do Windows.

## Próxima preparação da publicação

Com o inventário autorizado, identificar configuração e overrides reais (incluindo o preview da homologação), imagens em uso, migrações, volumes e espaço. Preparar a nova versão fora da árvore instalada; preservar a anterior e sua configuração privada em armazenamento protegido. Construir a imagem antes da troca e guardar a imagem anterior com referência própria. Não usar limpeza de imagens ou substituir a árvore existente.

Antes de trocar, comprovar recuperação do par banco/mídias em destinos isolados e a compatibilidade da versão anterior com as migrações propostas. Uma migração aditiva não prova compatibilidade de rollback. Se uma migração falhar, não reabrir escrita automaticamente sobre um estado parcial. O retorno de dados que perca gravações posteriores exige decisão específica; não automatizar restauração destrutiva.

Apresentar a versão final e o resultado do ensaio antes de publicar. Os testes desta rodada não permitem afirmar “deploy pronto”.

Sugestão após estas correções: três ciclos de revisão, pelo risco de recuperação de dados. Prompt copiável: “Revise em 3 ciclos: (1) consistência e restauração banco/mídia, concorrência e falhas; (2) bloqueio do deploy, retenção da versão anterior e recuperação; (3) portabilidade Windows, scratch/render e integração das diferenças locais. Execute checks pertinentes, preserve as cópias e não publique. Registre achados e limites reais.” A sugestão não significa que esses novos ciclos foram executados.
