# Black Estúdio — templates e roteiros

O Estúdio Black funciona dentro do BarberOS na rota `/estudio`. A entrega não altera caixa, agenda, checklist ou recrutamento.

## O que foi entregue

- Projetos privados do usuário autenticado da equipe.
- Até 20 originais por projeto, 100 MB por arquivo e 500 MB por projeto.
- Upload em stream para armazenamento privado, fora de `public/`.
- Ordem, cortes e texto manual por trecho.
- Novos projetos: templates Black Recrutamento, Serviços e Equipe em 1080 × 1920, 30 fps, até 120 segundos e áudio original. Título e chamada final (últimos 3 segundos) são editáveis. Textos ficam afastados das bordas; confira o corte vertical na prévia.
- Projetos anteriores conservam Black Vertical v1 (720 × 1280). A mudança de template é explícita, incrementa a revisão e exige nova renderização.
- Importação manual de roteiros aprovados do agente Conteúdo, exclusiva do dono solicitante, com referência imutável e auditoria. Não chama IA nem cria clipes fictícios.
- Projetos importados continuam restritos ao dono: mudar seu papel bloqueia consulta, mídia, fila e conclusão do trabalho sem apagar a origem. Projetos manuais continuam acessíveis à equipe proprietária.
- Atualizações periódicas preservam edições não salvas. Uma alteração concorrente mantém o rascunho visível e impede gravar sobre a nova revisão; carregar a versão atual exige descarte explícito. A confirmação de imagem, texto e áudio vale somente para o identificador do vídeo conferido.
- Fila persistente no PostgreSQL, com lease, heartbeat, cancelamento e recuperação de interrupção.
- Versões com snapshot imutável, arquivo e SHA-256.
- Reprodução privada com HTTP Range; o download final exige aprovação humana, data e SHA-256. A prévia permanece disponível para revisão. Versões antigas aprovadas continuam exportáveis.
- Estado real da fila, sem porcentagem fictícia.

Limites adicionais: 10 projetos por usuário, 10 versões por projeto, 2 GB por usuário e 10 GB globais.

## Dependência e isolamento

O render usa HyperFrames 0.8.198, fixado apenas em `workers/video`. O FFmpeg normaliza e valida os clipes; o HyperFrames aplica o preset e exporta o MP4. Nenhum plugin é instalado no aplicativo principal.

O processador recebe somente os arquivos do trabalho com lease válido. Ele não recebe `DATABASE_URL`, segredo de sessão, dados financeiros, WhatsApp ou chaves de IA. Os templates são fechados e versionados em `workers/video/templates.json`; o aplicativo e o worker usam esse catálogo. O roteiro completo fica no projeto, e o snapshot do render leva só sua referência. Textos são escapados, sem aceitar HTML, JavaScript ou URLs de templates externos. Telemetria, instalação e atualização automáticas ficam desativadas.

Os presets v2 usam qualidade `standard` do HyperFrames 0.8.198. O v1 mantém `draft` e sua composição original. O worker anuncia `black-vertical-v2/hyperframes-0.8.198`; a fila não oferece v2 a workers antigos e a API exige heartbeat compatível antes de enfileirar 1080p.

Na homologação, o worker roda em rede interna, sem porta pública, com limites de CPU, memória e processos. O aplicativo usa um volume persistente exclusivo para mídias.

Os temporários `/worker/jobs` usam tmpfs de até 1,5 GiB nos dois Composes do Studio. `TMPDIR` aponta para essa mesma área e é repassado ao render: o HyperFrames exige pelo menos 1 GiB livre antes de iniciar. O conteúdo é descartado ao reiniciar o container, inclusive depois de interrupção abrupta. O volume antigo `estudio_jobs` não é apagado. O tmpfs consome parte do limite total de 2 GiB do worker; sua capacidade não é memória reservada adicional. Espaço insuficiente faz o trabalho falhar, sem crescer indefinidamente no disco da VPS. O teste de publicação renderiza mídia sintética com esses limites; isso não comprova todos os vídeos no tamanho máximo.

## Operação

- `ESTUDIO_HABILITADO=true` controla a exibição da aba e o acesso à API.
- `ESTUDIO_STORAGE_ROOT` deve apontar para um volume persistente privado.
- `ESTUDIO_WORKER_TOKEN` deve ter pelo menos 32 caracteres e ser compartilhado somente entre app e worker.
- O botão Gerar fica indisponível quando o heartbeat do worker está ausente.
- A alteração da montagem exige uma nova versão antes da aprovação.
- Aprovação, ajustes, cancelamento e exportação entram na auditoria.

Uma interrupção abrupta entre arquivo e commit pode deixar arquivo órfão. A limpeza deve comparar volume e banco; nunca remover o volume indiscriminadamente. Backups precisam abranger banco e mídia no mesmo ponto.

O backup usa o banco restaurado do dump para selecionar as mídias imutáveis, copia apenas as referências válidas e verifica uma restauração real com SHA-256. O arquivo `.studio.tar.gz` guarda o hash do dump correspondente. Arquivo apagado durante a cópia faz a operação falhar. A rotina diária só marca restauração concluída depois da conferência de banco e mídias. Guarde o par completo; veja [backups e restauração](architecture.md#backups-e-restauração).

## Validação

- `npm test`
- `node --test workers/video/tests/*.test.mjs`
- `npm run teste:estudio:templates`: banco exclusivo `barberos_estudio_templates_teste` em loopback, rede bloqueada e dados sintéticos. Valida permissões, origem, hash, idempotência, concorrência, snapshot, aprovação, exportação, cancelamento e legado.
- `node workers/video/tests/smoke-templates.mjs`: render real dos quatro presets com dois clipes sintéticos, corte e áudio. Exige `ESTUDIO_WORKER_TMP` e os três executáveis `HYPERFRAMES_*_PATH`. `ESTUDIO_SMOKE_PRESERVAR=true` conserva MP4/quadros para inspeção local. O workflow de publicação usa esse teste dentro dos limites do container antes de disponibilizar uma versão.
- `scripts/teste-estudio.ts` usa apenas banco `estudio_test` e servidor local, cria usuários e vídeos sintéticos, e testa acesso, concorrência, upload, fila, lease, cancelamento, render e aprovação.

## Escopo futuro

Transcrição, edição sugerida por IA, aprovação pelo WhatsApp e publicação no Instagram não estão simuladas nesta entrega. Cada integração será adicionada com fornecedor, custo, consentimento e confirmação definidos.

## Fluxo com a Central

1. O dono aprova um resultado do agente Conteúdo e abre o atalho para o Estúdio, inclusive para roteiros anteriores aos 50 mais recentes. A seleção direta revalida proprietário e aprovação. Também pode escolher entre seus 50 roteiros aprovados mais recentes no Estúdio.
2. A importação confere solicitante, estado, aprovação, revisão e SHA-256 do conteúdo. Uma restrição única por usuário e execução evita duplicidade. Importar de novo abre o projeto existente sem sobrescrever a montagem.
3. O projeto guarda tarefa, resumo, entregáveis, alertas, aprovador, data, revisão, hash e responsável pela importação. São referência para escolher os vídeos e adaptar textos; não se transforma prosa livre em código de renderização.
4. O usuário escolhe template, envia os originais, ajusta cenas, título e chamada, gera e assiste à prévia. Aprova o arquivo para baixar o MP4. Aprovação de roteiro e aprovação de vídeo são independentes; nenhuma delas autoriza anúncio, envio ou gasto.

## Migração e recuperação

A migração `20261102040000_estudio_templates_roteiros` roda depois de `20261102030000_central_agentes` e adiciona campos ao projeto e vínculo opcional à execução, sem reescrever versões, mídias ou aprovações. O default do banco permanece v1 para conservar projetos existentes; somente a criação pela nova aplicação seleciona v2. Banco e worker devem ser atualizados juntos. Uma aplicação nova com worker antigo permite preparação, mas bloqueia render 1080p.

Antes de qualquer futura publicação, validar backup de banco **e mídias**, restauração e smoke no container com os limites atuais. O ensaio de banco local não substitui essa recuperação operacional. Em rollback, pausar render e restaurar o par completo validado; não remover colunas ou reinterpretar snapshots v2 como v1. Não houve migração nem publicação em produção nesta evolução.

## Integração visual — 01/11/2026

O módulo aparece como **Black Estúdio** no menu agrupado e no atalho do painel quando
`ESTUDIO_HABILITADO=true`. Rotas `/estudio` e `/api/estudio/*`, isolamento por proprietário, token do worker,
limites de upload, revisão e aprovação foram preservados. A tela usa o design Black aprovado e mostra contagens
reais dos projetos, clipes e versões aprovadas do usuário. A disponibilidade da montagem continua vindo do
heartbeat do processador; mostrar o editor não significa que o worker de produção foi ativado.
