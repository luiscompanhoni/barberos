# Pessoa remunerada sem checklist

O dono pode incluir uma pessoa em RH → Funcionários → Adicionar pessoa somente no RH. A ficha contém nome, contato, cargo, salário e início da vigência. Não cria conta de acesso, cadeira, tarefas, notificações, despesa ou folha fechada. O salário entra na prévia aberta e continua sujeito à conferência e aprovação existentes.

`POST /api/rh/funcionarios` exige sessão atual do dono, JSON da mesma origem, competência atual ou futura e UUID estável por tentativa. A criação, versões e auditoria são transacionais. Repetir a mesma tentativa reaproveita a ficha; dados diferentes com o mesmo UUID ou contato já presente são recusados. O cadastro não identifica pessoas automaticamente nem une fichas pelo contato.

Checklist e Acessos compartilham a trava de cadastro: não podem criar outra ficha com contato já reservado a uma pessoa exclusiva do RH. A rejeição preserva os registros e pede conferência de identidade; não promove a pessoa a gerente nem cria vínculo automaticamente.

## Migração e preservação

A migração `20261109000000_rh_sem_checklist` somente permite NULL em `checklist_pessoas.funcao`. Nenhuma função, pessoa, tarefa, vínculo ou remuneração existente é alterada. NULL significa não participar do checklist, inclusive nos links públicos, fotos, geração de itens, ranking e envios. A ficha continua ativa para o RH. O PUT integral do checklist exclui essas fichas de seu escopo e rejeita tentativa de atribuir-lhes função.

Aplicar a migração após backup restaurado em ambiente isolado e com escritores suspensos, pelo procedimento de publicação existente. Só criar fichas neutras após todos os processos executarem a nova versão. O cliente Prisma antigo declara o campo obrigatório: convivência com o binário antigo ou rollback após criar NULL não está homologado.

Recuperação preferencial: avançar com a versão corrigida, preservando o banco. Antes de qualquer retorno ao binário anterior, suspender escritores e consultar `SELECT count(*) FROM checklist_pessoas WHERE funcao IS NULL`. Se houver registros, interromper o retorno; não inventar função nem excluir ficha para satisfazer o cliente antigo. Uma contração futura deve preservar essas fichas em modelo compatível e ser revisada separadamente. Se nenhum NULL tiver sido criado e a recuperação exigir reverter a nulabilidade, validar primeiro os dados e a restauração; a mudança SQL inversa é `ALTER TABLE checklist_pessoas ALTER COLUMN funcao SET NOT NULL`.

## Validação local

`npm run check` cobre tipos, lint, testes unitários e build. A integração direcionada é `TESTE_RH_SEM_CHECKLIST_LOCAL=1 npx vitest run tests/rh-sem-checklist-banco.test.ts`; o teste exige usuário `auditoria_teste`, `127.0.0.1:55439` e banco novo `barberos_ci_local_regr_rh_<8 dígitos>`. Não inicia nem reconfigura PostgreSQL. Aplicar migrations e seed somente nesse banco, executar também `npm run teste:rh` e descartar a base dedicada após preservar o resultado.

Os testes usam exclusivamente identidades fictícias e bloqueiam a rede externa. Não certificam cadastro real, homologação de folha ou envio bancário. A publicação e a criação de fichas reais são etapas separadas.

No CI Linux, os testes unitários de cadastro e rota entram em `npm test`; `npm run teste:rh` entra em `teste:todos`, com banco exclusivo. Os nove cenários de `rh-sem-checklist-banco.test.ts` têm etapa própria sequencial, após os fluxos, na base descartável separada `barberos_ci_local_regr_rh_20261109`: migrações e seed, flag explícita, HTTP bloqueado e resultado JSON exigindo todos aprovados sem pulos. A autorização nominal da migração no publicador aceita somente `20261109000000_rh_sem_checklist`; seu teste também confere que o SQL revisado continua sendo apenas a expansão de nulabilidade.
