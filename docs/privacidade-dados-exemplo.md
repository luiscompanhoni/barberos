# Dados de exemplo e importação CashBarber

`scripts/dados/cashbarber.json` contém apenas dados sintéticos. Nomes, valores, serviços, planos e horários não representam a Black Barber. Os identificadores de telefone `sintetico-001` e `sintetico-002` não são discáveis e o exemplo não cria donos.

A execução padrão do importador agora recusa a fixture. Para exercícios, use `--exemplo` com PostgreSQL em loopback e nome de banco `barberos_test*`, `barberos_teste*` ou `barberos_demo*`, separado dos dados operacionais. Também são recusados exemplos contendo telefone discável ou indicação de dono.

Uma importação operacional requer arquivo privado informado com `--arquivo`, estrutura compatível e campo `tipoDados: "EXPORTACAO_REAL"`. Essa marcação é declaração de origem, não valida a identidade ou a qualidade de uma exportação. A execução de importação em produção depende de revisão específica, backup restaurado, conferência de vínculos e autorização; esta correção não executou importação alguma.

Guarde exportações reais fora do repositório, com acesso restrito e prazo de retenção definido. Não envie dados pessoais para testes, exemplos, logs ou CI. Não copie nomes e contatos reais para substituir os exemplos. O arquivo privado não deve ser incluído em commit, imagem de teste ou artifact público.

A substituição da fixture remove dados reais da árvore atual. Ela não reescreve commits anteriores, clones, artifacts ou backups; revisar acesso e retenção dessas cópias é uma tarefa separada. Não foi criado um novo arquivo com os dados pessoais removidos.
