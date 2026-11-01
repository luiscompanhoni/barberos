# Continuidade e publicação do BarberOS

Esta conversa é o ponto de acompanhamento solicitado pelo dono: descrever a mudança, alinhar o comportamento, implementar, testar, apresentar a versão e publicar somente o escopo autorizado. Uma tarefa preparada ou um PR integrado não comprovam publicação.

Estado verificado e pendências da retomada: [evidências de 28/10/2026](evidencias-operacao-2026-10-28.md). Este procedimento está preparado; a execução completa no VPS ainda não foi validada nesta retomada.

## Escolher a cópia sem perder trabalho

1. Confirmar o sistema operacional e a pasta efetiva da ferramenta. Uma aba do navegador ou um caminho Windows mencionado na conversa não concede acesso ao computador.
2. Inventariar as cópias e worktrees: raiz Git, branch, HEAD, upstream, status, stash e commits locais. Consultar o remoto sem substituir arquivos. Comparar conteúdo, não apenas nomes de branches ou contagem de commits; squash e cherry-pick alteram a ancestralidade.
3. Preservar arquivos modificados, novos arquivos e commits não publicados. Não usar reset, clean, troca forçada de branch ou stash automático. Git não enxerga buffers não salvos do editor: preservar também esses buffers antes de mexer na cópia.
4. Trabalhar em checkout separado quando a cópia estiver suja. A publicação deve partir de um commit identificado e de uma árvore limpa, depois de revisar qualquer diferença local que possa fazer parte do pedido. Não empacotar uma pasta de trabalho arbitrária.

## Validar acesso e instalação, primeiro somente leitura

O ambiente preferencial nesta retomada é o Windows onde o usuário já verificou TCP/22 acessível. Ainda falta comprovar autenticação SSH e acesso atual à cópia correta nesse ambiente.

- Reutilizar a chave existente, informada pelo caminho local ou disponibilizada por agente/cofre seguro. Conferir permissões e impressão digital pública; nunca imprimir a privada, copiar segredos para o chat ou colocá-los no repositório.
- Uma chave em outra sessão não está automaticamente disponível no Windows. Não criar outra chave nem alterar firewall para diagnosticar a falha de rede da nuvem.
- Validar a identidade do host por uma impressão digital conhecida ou obtida no console autenticado da Hostinger. Não desabilitar a verificação nem apagar uma identidade divergente.
- Testar autenticação com comando remoto somente de leitura, registrando usuário e hostname. Porta aberta não comprova autenticação; recusa TCP anterior à autenticação não invalida a chave.
- Depois do acesso, conferir diretório, projeto Compose, serviços, imagens, volumes, espaço disponível e configuração pública de domínio. Ler apenas campos necessários. Não despejar `.env`, `docker inspect` completo, configuração Compose expandida ou logs com OTP/segredos.

O repositório define `/opt/barberos`, projeto Compose `barberos`, arquivo `deploy/docker-compose.yml` e serviços `app`, `db`, `caddy`, `backup`; `evolution` depende do profile. Esses são valores de referência, não uma inspeção da instalação atual.

Identificar o que está **rodando**, além dos arquivos no disco: ID da imagem do container, estado/healthcheck, identificação do build, eventual revisão gravada e migrações aplicadas. O deploy atual não inclui necessariamente `.git`, e `/api/saude` só retorna saúde do banco. Sem vínculo verificável entre build e commit, registrar “commit desconhecido”; não deduzir o SHA pelo GitHub, pela data ou por uma resposta HTTP 200.

Se a versão pretendida já estiver instalada, conferir migrações e comportamento antes de decidir por outra publicação. Repetir deploy não é a verificação inicial.

## Apresentar a entrega

Antes de publicar, registrar o commit escolhido, a comparação com a instalação atual, funcionalidades incluídas, migrações pendentes, configurações necessárias e testes já aprovados. Não incluir silenciosamente outra branch. Seguir a autorização vigente; pedir decisão apenas para diferença de escopo ou ação ainda não autorizada.

Para cada alteração nova, alinhar comportamento observável e permissões, implementar e executar os checks pertinentes. Testes de fluxo usam banco descartável; nunca executar seed, fixtures ou `migrate dev` no banco real.

## Reaproveitar os scripts com preservação e recuperação

Fontes existentes: [deploy](../scripts/deploy.sh), [backup](../deploy/backup.sh), [Compose](../deploy/docker-compose.yml), [Dockerfile](../Dockerfile) e [restauração](architecture.md#backups-e-restauração).

Desde a correção de 01/11, a entrada de produção do script legado encerra antes de qualquer pacote ou conexão. Os riscos abaixo descrevem o caminho que motivou o bloqueio, não um procedimento autorizado para contorná-lo. Ainda falta implementar e ensaiar a troca/recuperação com a configuração efetiva da VPS. O backup novo cobre banco e mídias quando o override Studio está aplicado; não foi instalado na VPS.

Limites constatados em `scripts/deploy.sh`, na revisão `baf1ac8`:

- Empacota arquivos versionados **e novos não ignorados**, incluindo mudanças não commitadas. Executá-lo apenas de checkout limpo do commit escolhido e conferir o pacote.
- O backup anterior à troca depende de `.env`, Compose e banco em execução; se o banco não estiver rodando, esse bloco é pulado. Na atualização de produção, tratar ausência de qualquer requisito como impedimento, não como primeira instalação.
- Confere o gzip do dump, mas essa etapa não prova restauração. A rotina `deploy/backup.sh` já oferece restauração de teste em banco separado: reutilizá-la e conferir o resultado efetivo.
- Remove a maior parte dos arquivos da instalação antes do build. Antes disso, inventariar arquivos persistentes e preservar fonte, configuração privada e imagem anterior fora dos caminhos removidos.
- Executa `docker image prune -f`; preservar a imagem anterior com tag própria e cópia recuperável antes de qualquer limpeza. O script não implementa rollback automático.
- Inclui configuração de Docker, rede e regras UFW em alguns caminhos. Não executar mudanças de infraestrutura não autorizadas; nesta retomada, preservar o firewall. Adequar esse caminho antes de reutilizar o script na instalação existente.
- Termina exibindo containers após cinco segundos, sem aguardar saúde estável ou testar os fluxos. A mensagem de conclusão não comprova publicação funcional.

Sequência a concretizar depois da inspeção do VPS:

1. Registrar imagem, fonte, configuração e migrações anteriores em armazenamento privado; conferir capacidade de recuperação sem expor dados.
2. Fazer o backup com a rotina existente e conferir restauração isolada, arquivo, integridade e resultado. Não repetir uma cópia recente por hábito: verificar sua adequação e considerar gravações ocorridas desde então. Não confiar somente em um código de saída ou na existência do arquivo.
3. Preparar o build do commit aprovado antes da troca. Conferir as migrações ainda pendentes contra o banco real; a quantidade no Git não é a quantidade a aplicar.
4. Definir e testar o retorno à imagem anterior com o schema resultante. Novos valores de enum e dados gravados podem impedir compatibilidade, mesmo com migrações que adicionam tabelas/colunas. Não prometer reversão só trocando o container.
5. Publicar preservando `.env`, volumes e sites adicionais. O Dockerfile existente executa `prisma migrate deploy` antes de iniciar o servidor; não alterar manualmente checksums nem repetir migrations aplicadas.
6. Aguardar saúde estável, conferir migrações, HTTPS, rotas e fluxos relevantes. Registrar commit, checksum do pacote, imagem em execução, backup usado e resultado, sem segredos.

Se for necessário restaurar o banco, considerar a perda das gravações posteriores ao backup e obter decisão explícita para esse retorno. Não executar restauração destrutiva automaticamente. A recuperação só está pronta quando a versão anterior e seus dados compatíveis estão identificados e recuperáveis.

## Critério de publicação concluída

- Serviço em execução e banco saudável, sem migração pendente ou falha para o pacote.
- HTTPS e login funcionando; agenda, equipe e demais fluxos alterados conferidos com acesso autorizado.
- Para o app: manifestos válidos, `/sw.js` respondendo JavaScript sem redirecionamento e central respeitando autenticação/permissões.
- Push real separado da publicação do código: exige configuração VAPID definitiva e teste em aparelho autorizado, conforme [guia](app-notificacoes.md). Não registrar envio simulado como entrega no celular.
- Registro final distingue **preparação**, **testes**, **publicação** e **ativação de integrações**. Falhas e pendências permanecem explícitas.

Guardar neste projeto o procedimento e evidências não sensíveis. Caminhos de chaves, backups, dados de clientes e configuração privada permanecem em registro operacional privado. Atualizar este documento com os passos realmente executados antes de chamá-lo de procedimento validado.
