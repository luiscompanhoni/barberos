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
   banco/app saudáveis, memória/disco mínimos e migrações conhecidas. As migrações permitidas nesta
   entrega são `20261102030000_central_agentes` e `20261102040000_estudio_templates_roteiros`; qualquer outra migration pendente bloqueia
   a publicação. As migrações do Estúdio original e do editor histórico devem já estar aplicadas. Futuras migrations precisam de revisão explícita. O ensaio local dos templates não autoriza publicar.
4. A imagem antiga do app recebe tag de preservação obrigatória. A imagem anterior do backup também é
   preservada quando ainda existe no Docker; a instalação legada pode manter um container de backup cuja
   imagem foi removida. Essa ausência fica registrada e não libera a troca sem verificar o backup novo.
   O backup novo cria o par banco/mídia e restaura
   ambos para verificar integridade. Durante a publicação, não faz limpeza de backups nem envio externo.
5. Um segundo banco exclusivo ensaia as migrations, confere schema e testa os modelos do cliente Prisma
   anterior. Não inicia o servidor antigo nessa cópia, evitando cron, pagamentos e mensagens reais.
   A cópia é removida depois do ensaio; a produção não é restaurada sobre nenhum backup.
6. Um segredo do worker é criado somente no servidor se ainda não existir, em arquivo separado e
   protegido. A configuração original é preservada. As migrations são aplicadas explicitamente, antes
   da troca; o comando do app passa a ser `node server.js` para não repetir migrations na recuperação.
7. O override da release habilita a interface da Central (`AGENTES_HABILITADOS=true`), força
   `AGENTES_EXECUCAO_ATIVA=false` e `META_ADS_TOKEN` vazio, mesmo se o `.env` contiver outros valores.
   A configuração original e a credencial do bot preexistente são preservadas. O ambiente do container
   novo é conferido sem exportar segredos. A Central não possui transporte de anúncios, mensagens ou pagamentos.
   A troca afeta app e backup; db, Caddy, homologação e Evolution permanecem em execução. O worker só
   inicia após saúde estável e confirmação da revisão por HTTPS. A API do Studio deve recusar acesso
   anônimo, assim como `/api/agentes`; o worker deve autenticar e registrar presença. Um novo backup verifica o estado pós-migração.
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

A primeira execução, [41348137928](https://github.com/luiscompanhoni/barberos/actions/runs/41348137928),
construiu as imagens e passou no ensaio real de restauração de banco/mídia. O render sintético bloqueou
a publicação antes de acessar a VPS: o HyperFrames exige 1 GiB livre tanto no temporário quanto no destino,
e `/tmp` tinha limite de 256 MiB; `/worker/jobs`, de exatamente 1 GiB, já continha o vídeo de entrada.
A correção usa a mesma área `TMPDIR=/worker/jobs` com limite de 1,5 GiB, mantendo o limite total de memória
em 2 GiB. A verificação de espaço do motor permanece ativa e o teste real continua obrigatório.

Na [execução 41349187957](https://github.com/luiscompanhoni/barberos/actions/runs/41349187957), imagens,
restauração sintética e render real passaram. A preservação da imagem app também concluiu. A preparação
parou ao tentar preservar a imagem do backup antigo, antes de executar backup, migration ou troca.
A [consulta 41349909425](https://github.com/luiscompanhoni/barberos/actions/runs/41349909425) confirmou
que essa imagem já não existia no Docker, embora o container continuasse rodando; a tag do backup apontava
para outra imagem. A correção registra essa condição, mantém o container até validar o backup novo e
preserva a recuperação obrigatória do aplicativo. O retorno do app continua usando o backup novo, que
cobre as mídias do Studio, sem restaurar destrutivamente o banco.

Se a conexão cair, consulte primeiro a instalação e `operacao.json`; não repita automaticamente uma
execução incerta. Uma release existente é preservada e não é sobrescrita. Não se executa `image prune`.

Se faltar a reserva de disco antes do transporte, o fluxo pode liberar uma vez cache de construção
descartável sem uso há mais de 48 horas (`builder prune`, sem `--all`, mantendo 10 GB de cache).
Essa operação usa a trava de publicação, exige a imagem atual saudável e confere a preservação de
todas as imagens/tags, containers, volumes e hashes dos backups/configurações. A reserva de disco
é verificada novamente; não há redução dos limites, exclusão de backups ou remoção de imagens antigas.
O diagnóstico de capacidade e o resultado dessa manutenção ficam somente no relatório cifrado.

Revisão sugerida, sem execução automática: cinco ciclos pelo impacto em produção.
Prompt: “Revise em cinco ciclos o transporte e os segredos; preservação dos arquivos; backup/restauração;
migração e compatibilidade anterior; troca/recuperação e evidências reais. Preserve as alterações locais,
não restaure produção destrutivamente e diferencie testes simulados de publicação comprovada.”
