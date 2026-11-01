# Evidências da retomada — 28/10/2026

Consultas realizadas por volta de 21h10, America/Sao_Paulo. Nenhuma alteração no VPS, backup, migração ou publicação foi executada nesta retomada. Procedimento: [operação de produção](operacao-producao.md).

## Código identificado

| Evidência | Resultado |
|---|---|
| [PR #8](https://github.com/luiscompanhoni/barberos/pull/8) consultado no GitHub | Integrado em 28/10/2026 às 14h18; base `main` |
| Commit de merge e `main` remota | `baf1ac84e85686be2fe440dccbda895b798b0bb5` |
| Branch da implementação | `codex/evolucao-equipe-app-notificacoes`, commit `4c280b2acf0926a652505a2a549ca6d3de524962` |
| Checkout acessível nesta sessão | Linux, `/workspace/barberos`, `main` no mesmo SHA; limpo antes de adicionar estes registros |
| [CI da main](https://github.com/luiscompanhoni/barberos/actions/runs/40734437183) | `completed`, `success`, SHA correspondente |
| Migrações no pacote | 43 arquivos `migration.sql`; quatro adicionados em 28/10 |

O pacote identificado contém reuniões e projeções, edição de acessos, agenda/bloqueios/encaixes, recompra, presença/desempenho/avaliações e aplicativo instalável com central de notificações. Detalhes em [evolução da equipe](evolucao-equipe.md) e [app](app-notificacoes.md).

O histórico desta tarefa registra 486 testes unitários, 18 suítes de fluxo, build e verificações de navegador aprovados. O status do CI foi consultado novamente; a suíte não foi repetida para a alteração documental desta retomada. Instalação em aparelho e push real continuam sem evidência de validação.

## Cópias do Windows: evidência histórica, sem nova inspeção local

Foi consultado o diagnóstico anterior chamado “Diagnosticar deploy pelo Windows”, incluindo suas saídas Git. Os caminhos completos ficam no handoff privado, fora do repositório público.

| Cópia | Estado observado anteriormente | Consequência |
|---|---|---|
| `barberos` | Branch `codex/cadastros-verificados`, HEAD `4f885bebaeb224e25fe61afd4ec1813facb3c59a`, arquivos modificados e novos | Preservar e comparar antes de atualizar; há mudanças em schema, navegação, RH e arquivos de recrutamento |
| `barberos-estudio` | Branch `feat/estudio-black`, HEAD `b2f94d853fae7ac483f8fbf98495046cac0134a5`, limpa, upstream apontando a `origin/main` | Limpa não significa publicada ou equivalente à main; conferir commits locais |

Na consulta atual, a branch remota `feat/estudio-black` aponta para `2eec748e4c28c10d87be160479d66296b7c53c56`, diferente do HEAD local registrado. A API do GitHub não encontrou `b2f94d8` (HTTP 422). Isso não autoriza descartar essa cópia; o commit pode existir somente no Windows. A branch remota `codex/cadastros-verificados` aponta para `3f48d89758488fbbafb0e2e1d0fe9f435fa8cb0d`.

Contagens anteriores de ahead/behind usavam refs locais antigas. Não foram tratadas como estado atual do GitHub nem como prova de funcionalidades ausentes. A identificação do PR #8 é conclusiva para o pacote desta tarefa; a incorporação de diferenças adicionais do Windows ainda depende de comparação.

## Destino e observação pública

- Referência anterior fornecida pelo usuário: `root@179.236.244.156`, **porta** SSH 22. O valor `1779.236.244.156` da nova mensagem não é IPv4 válido; não foi usado como destino.
- `painel.appblackbarber.com` resolveu para `179.236.244.156` e coincide com os exemplos de domínio do projeto e o histórico do painel.
- `painel.aptriber.com` não resolveu nesta consulta. Nenhuma configuração de domínio foi alterada.
- Os valores reais de `.env`, Caddy e serviços no VPS continuam pendentes de inspeção autenticada. DNS do painel, sozinho, não comprova identidade do host SSH.

Consultas HTTPS somente de leitura, sem sessão de cliente:

| Caminho em `https://painel.appblackbarber.com` | Resultado |
|---|---|
| `/api/saude` | HTTP 200; JSON `ok: true` |
| `/entrar` | HTTP 200 |
| `/manifest-equipe.webmanifest` | HTTP 404 |
| `/manifest-cliente.webmanifest` | HTTP 404 |
| `/sw.js` | HTTP 307 |
| `/api/notificacoes` | HTTP 404 |

O serviço responde, mas os recursos esperados do pacote não estão disponíveis nesse endereço. Isso indica publicação ausente ou incompleta para essas rotas; não identifica o commit em execução. `/api/saude` não expõe revisão do build. Não há evidência suficiente para declarar o PR #8 publicado ou para repetir deploy sem inspeção.

## Acesso e ponto de interrupção

- Relato do usuário: SSHD escutando em IPv4/IPv6 na porta 22; UFW inativo; nenhum firewall mostrado na Hostinger; teste TCP/22 no Windows retornou verdadeiro. Não foram alterados nem reconfigurados.
- Histórico desta sessão: SSH e outros testes TCP diretos falharam na nuvem antes da autenticação; HTTPS via proxy funciona. O conjunto aponta para uma diferença no caminho de rede do ambiente, sem identificar sua regra exata. Não comprova chave inválida ou SSHD desligado.
- A chave dedicada da nuvem continua presente; diretório com modo 0700 e arquivos com modo 0600. Sua impressão digital pública foi conferida. O histórico registra que a privada era legível e correspondia à pública, mas nenhuma autenticação no VPS foi comprovada.
- O diagnóstico anterior do Windows encontrou ferramentas SSH/Git e uma chave candidata de homologação, com ACL restrita. Sua autorização para produção permanece desconhecida; reutilizar para teste autorizado, sem criar outra chave nem presumir sucesso.
- As ferramentas desta retomada leem o histórico das tarefas, mas executam comandos somente no Linux da nuvem. Não há ferramenta atual para executar no Windows ou controlar seu console Hostinger. Uma tarefa antiga ter executado PowerShell não concede essa capacidade à sessão atual.

Não foi repetida tentativa SSH sem mudança no ambiente. O próximo passo depende de uma sessão local do Codex no Windows, vinculada à pasta já identificada; somente depois será possível confirmar o estado das cópias e autenticar usando a chave local.

## Preparação operacional

`scripts/deploy.sh`, `deploy/backup.sh`, `deploy/docker-compose.yml`, Dockerfile e instruções de restauração foram revisados. Os dois scripts passaram em `bash -n`. Essa validação é sintática; não equivale à execução ou à restauração de um backup real.

O deploy existente pode incluir trabalho não commitado, pular backup quando o banco não está em execução, remover arquivos antes do build e limpar imagens antigas. Também possui um trecho que altera UFW ativo. As condições para reaproveitá-lo preservando dados, infraestrutura e rollback estão registradas no [procedimento](operacao-producao.md#reaproveitar-os-scripts-com-preservação-e-recuperação); o script não foi modificado nem executado nesta retomada.

| Etapa | Estado |
|---|---|
| Implementação do pacote e merge | Concluídos, com SHA/PR identificados |
| Testes de código | Aprovados anteriormente; CI correspondente confirmado |
| Preservação das cópias Windows | Não tocadas; inventário atual e cópia de segurança ainda pendentes |
| Autenticação SSH nesta retomada | Não validada; depende do ambiente local |
| Versão, serviços e configuração reais do VPS | Pendentes de inspeção autenticada |
| Backup restaurável e rollback da atualização | Procedimento preparado; execução/verificação pendentes |
| Publicação do pacote | Não comprovada; não repetida |
| Push real em aparelho | Configuração privada e teste final pendentes |
