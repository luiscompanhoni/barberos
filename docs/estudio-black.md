# Estúdio Black — primeira entrega

O Estúdio Black funciona dentro do BarberOS na rota `/estudio`. A entrega não altera caixa, agenda, checklist ou recrutamento.

## O que foi entregue

- Projetos privados do usuário autenticado da equipe.
- Até 20 originais por projeto, 100 MB por arquivo e 500 MB por projeto.
- Upload em stream para armazenamento privado, fora de `public/`.
- Ordem, cortes e texto manual por trecho.
- Preset Black Vertical: 720 × 1280, 30 fps, até 120 segundos, áudio original.
- Fila persistente no PostgreSQL, com lease, heartbeat, cancelamento e recuperação de interrupção.
- Versões com snapshot imutável, arquivo e SHA-256.
- Reprodução privada com HTTP Range, revisão, aprovação e download.
- Estado real da fila, sem porcentagem fictícia.

Limites adicionais: 10 projetos por usuário, 10 versões por projeto, 2 GB por usuário e 10 GB globais.

## Dependência e isolamento

O render usa HyperFrames 0.8.198, fixado apenas em `workers/video`. O FFmpeg normaliza e valida os clipes; o HyperFrames aplica o preset e exporta o MP4. Nenhum plugin é instalado no aplicativo principal.

O processador recebe somente os arquivos do trabalho com lease válido. Ele não recebe `DATABASE_URL`, segredo de sessão, dados financeiros, WhatsApp ou chaves de IA. O template é fixo e o texto do usuário é escapado. Telemetria, instalação e atualização automáticas ficam desativadas.

Na homologação, o worker roda em rede interna, sem porta pública, com limites de CPU, memória e processos. O aplicativo usa um volume persistente exclusivo para mídias.

## Operação

- `ESTUDIO_HABILITADO=true` controla a exibição da aba e o acesso à API.
- `ESTUDIO_STORAGE_ROOT` deve apontar para um volume persistente privado.
- `ESTUDIO_WORKER_TOKEN` deve ter pelo menos 32 caracteres e ser compartilhado somente entre app e worker.
- O botão Gerar fica indisponível quando o heartbeat do worker está ausente.
- A alteração da montagem exige uma nova versão antes da aprovação.
- Aprovação, ajustes, cancelamento e exportação entram na auditoria.

Uma interrupção abrupta entre arquivo e commit pode deixar arquivo órfão. A limpeza deve comparar volume e banco; nunca remover o volume indiscriminadamente. Backups precisam abranger banco e mídia no mesmo ponto.

## Validação

- `npm test`
- `node --test workers/video/tests/*.test.mjs`
- `scripts/teste-estudio.ts` usa apenas banco `estudio_test` e servidor local, cria usuários e vídeos sintéticos, e testa acesso, concorrência, upload, fila, lease, cancelamento, render e aprovação.

## Escopo futuro

Transcrição, edição sugerida por IA, aprovação pelo WhatsApp e publicação no Instagram não estão simuladas nesta entrega. Cada integração será adicionada com fornecedor, custo, consentimento e confirmação definidos.
