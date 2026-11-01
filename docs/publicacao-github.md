# Publicação pelo Codex e GitHub

O usuário autorizou o design Black e a ativação do Black Estúdio. O acesso GitHub → VPS foi validado
em [41345736651](https://github.com/luiscompanhoni/barberos/actions/runs/41345736651). A consulta real
em [41346001658](https://github.com/luiscompanhoni/barberos/actions/runs/41346001658) confirmou app/banco
saudáveis, 44 migrações aplicadas e somente a migração Studio pendente. Os 703 arquivos de código
consultados correspondem à base anterior; uma migração usa CRLF no servidor. Seu SQL é idêntico ao LF
do Git. Nenhum checksum do banco deve ser regravado para normalizar esse caso.

## Procedimento preparado

**Publicar atualização na VPS** é manual, restrito à `main` e ao ambiente `produção`. O Codex pode
acioná-lo depois que o CI do mesmo SHA passar, fornecendo a imagem app do inventário e uma chave pública
exclusiva para cifrar o relatório. Não é necessário manipular a chave SSH novamente no Windows.

1. Os testes da operação precisam passar. Código e imagens app/backup/worker recebem o mesmo SHA.
   As imagens são construídas no runner, sem segredos de produção, e passam pelo ensaio sintético de
   backup/mídia e testes do render. O pacote contém somente arquivos do commit identificado.
2. O transporte exige host conhecido e chave exclusiva. O código vai para uma pasta nova em
   `releases/<sha>`, dentro da instalação; não substitui o código antigo, `.env`, Caddy ou outros sites.
   A recepção confere hashes, rejeita links e caminhos fora da pasta e não sobrescreve release existente.
3. Uma trava no servidor impede duas publicações simultâneas. O script exige a imagem antiga esperada,
   banco/app saudáveis, memória/disco mínimos e migrações conhecidas. A migração nova permitida nesta
   entrega é `20261025000000_estudio_black`; futuras migrations precisam de revisão explícita do código.
4. As imagens antigas recebem tags de preservação. O backup novo cria o par banco/mídia e restaura
   ambos para verificar integridade. Durante a publicação, não faz limpeza de backups nem envio externo.
5. Um segundo banco exclusivo ensaia as migrations, confere schema e testa os modelos do cliente Prisma
   anterior. Não inicia o servidor antigo nessa cópia, evitando cron, pagamentos e mensagens reais.
   A cópia é removida depois do ensaio; a produção não é restaurada sobre nenhum backup.
6. Um segredo do worker é criado somente no servidor se ainda não existir, em arquivo separado e
   protegido. A configuração original é preservada. As migrations são aplicadas explicitamente, antes
   da troca; o comando do app passa a ser `node server.js` para não repetir migrations na recuperação.
7. A troca afeta app e backup; db, Caddy, homologação e Evolution permanecem em execução. O worker só
   inicia após saúde estável e confirmação da revisão por HTTPS. A API do Studio deve recusar acesso
   anônimo; o worker deve autenticar e registrar presença. Um novo backup verifica o estado pós-migração.
8. Em falha depois da troca, o script para o worker e tenta recuperar a imagem anterior do app com o
   schema já ensaiado. Mantém as novas tabelas e mídias, e o backup novo continua cobrindo as mídias.
   Nunca restaura o banco automaticamente, evitando perda de gravações posteriores. O registro privado
   informa a etapa que falhou e se o retorno ficou saudável. Falha de recuperação exige intervenção.

Os relatórios exportados são cifrados. Chaves temporárias são removidas; segredo do worker e configuração
da produção ficam no servidor. O registro `versao-ativa.json` identifica a release e seus arquivos Compose.
Use o workflow para próximas atualizações: executar Compose a partir do diretório antigo pode selecionar
configuração anterior. O deploy legado continua bloqueado na candidata e não deve ser reativado.

## Limites e verificações

Os testes locais verificam arquivos malformados, preservação da instalação, equivalência CRLF, falhas de
backup e recuperação sem restauração destrutiva. Os testes de sequência usam processos simulados; a
restauração real, compatibilidade do schema e publicação são verificadas pelo workflow na execução.
Um teste sem sessão não comprova a navegação autenticada de todos os papéis. Não há abertura de sessão
em nome de um funcionário nem envio de mensagens/testes de pagamento na produção.

Se a conexão cair, consulte primeiro a instalação e `operacao.json`; não repita automaticamente uma
execução incerta. Uma release existente é preservada e não é sobrescrita. Não se executa `image prune`.

Revisão sugerida, sem execução automática: cinco ciclos pelo impacto em produção.
Prompt: “Revise em cinco ciclos o transporte e os segredos; preservação dos arquivos; backup/restauração;
migração e compatibilidade anterior; troca/recuperação e evidências reais. Preserve as alterações locais,
não restaure produção destrutivamente e diferencie testes simulados de publicação comprovada.”
