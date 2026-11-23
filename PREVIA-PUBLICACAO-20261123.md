# Prévia da atualização do BarberOS

23 de novembro de 2026 · horário de São Paulo · ensaio local com uma cópia do banco de produção.

**A atualização mantém o cartão clicável da roleta no WhatsApp.** Quando os envios estiverem liberados, o último balão do convite mostra a arte da Black Barber e abre a roleta ao tocar. Se o WhatsApp não aceitar a imagem em alta resolução, a Evolution tenta usar uma versão menor da miniatura. A publicação reaproveita a Evolution instalada para manter esse comportamento.

## O que muda

| Para quem | O que verá |
| --- | --- |
| **Clientes** | A vitrine leva a **Meus horários** após o login. Quem chegou por um link da agenda volta à página certa depois de entrar. Os planos comuns seguem disponíveis. |
| **Barbeiros e recepção** | A agenda preserva o fluxo normal de reservas. A caixa de Conversas distingue o Direct, mostra vínculos com clientes quando disponíveis e identifica envios simulados. A operação real do Direct depende da configuração e aprovação da Meta. |
| **Gestão** | Campanhas ganham indicadores de interesse e acompanhamento do funil da roleta. Assinaturas e Financeiro seguem acessíveis pelo painel, com contratos simulados da oferta fora das contagens e apurações comuns. |

[Detalhes da entrega](RESULTADO-PUBLICACAO-SEM-OFERTA.md)

## Promoção e envios

- **Dezembro Grátis continua desligada.** A oferta fica fora da vitrine, da agenda e das assinaturas. As páginas exclusivas e a API da oferta ficam fechadas.
- **Envios automáticos de WhatsApp, Direct e push seguem bloqueados no estado previsto para a publicação.** IA paga, acompanhamentos da roleta e cobranças automáticas ficam desligados. A exceção existente para códigos de login pedidos pelo próprio cliente depende de como o OTP estiver configurado. A maquininha segue no modo manual. Na leitura da configuração-base da VPS, as flags novas de oferta, Direct e acompanhamento da roleta estavam ausentes e caem nos padrões fechados do app. Confirme os valores efetivos no dia da publicação.
- O teste interno de convite de retorno continua restrito ao número do dono ativo. O contato normal pelo WhatsApp continua sujeito às preferências do cliente e às travas de envio.
- No ensaio, o aplicativo e o navegador ficaram isolados de serviços externos. A sessão usou uma conta temporária local e o teste não enviou mensagens.

## Tempo de parada

**Reserve 10 minutos de janela, em horário de baixo movimento. Planeje alguns minutos de indisponibilidade do painel e da agenda pública.** O banco migrou em cerca de 7 segundos no Mac. Na VPS, a pausa começa antes do backup verificado e inclui a restauração de prova, outras verificações e a confirmação de saúde do app antes de reabrir o acesso. O WhatsApp e a transcrição voltam no fim da publicação. A janela é uma estimativa operacional. Este ensaio mediu o banco e o app local, enquanto o tempo da cópia de mídia, dos containers e do acesso público depende da VPS.

## Como voltar se algo falhar

1. **Antes de isolar os serviços:** o publicador interrompe a operação e a versão instalada continua no ar.
2. **Depois de fechar o acesso, antes de começar a migração:** o publicador pode voltar à imagem realmente instalada, com os bloqueios verificados. O painel pode reabrir em modo restrito. Os serviços auxiliares aguardam conferência. Se a imagem anterior já não tinha o bloqueio de cobranças ativo, o acesso permanece fechado até a revisão.
3. **Depois que a migração começa:** mantenha o sistema isolado e preserve o banco atual, o backup e o registro da etapa. A equipe técnica verifica quais mudanças concluíram e decide entre corrigir adiante ou recuperar em banco e volume separados. Antes de qualquer troca, concilie os registros e eventos posteriores ao backup. O publicador mantém o marcador de recuperação e não restaura um backup sobre o banco atual.

[Procedimento de recuperação](docs/recuperacao-segura.md)

## Checklist do dia da publicação

- [ ] Conferir a imagem e a configuração **realmente em uso**, a tag local `barberos-evolution:2.3.7-previa-clicavel` e a imagem prevista para o retorno.
- [ ] Confirmar a revisão autorizada, o CI aprovado dessa revisão e a janela com o responsável pela operação. Conferir reserva de disco e memória e ausência de recuperação pendente.
- [ ] Confirmar oferta desligada, travas do WhatsApp e Instagram, push e IA paga desligados, cobrança automática bloqueada e maquininha manual. Conferir a configuração do código de login.
- [ ] Com os serviços parados, o publicador deve gerar backup de banco e mídia, verificar a restauração e testar a compatibilidade da imagem ativa antes de migrar o banco principal. Interromper se houver histórico divergente, lock que expire ou falha de restauração.
- [ ] Após a troca, confirmar a revisão e a saúde pelo acesso público. Abrir Agenda, Conversas, Assinaturas e Financeiro. Conferir o backup posterior e a retomada dos serviços auxiliares com os bloqueios em vigor.

## Anexo técnico

### Como o publicador toma a decisão

O workflow manual `.github/workflows/publicar.yml` roda para a `main`, exige CI concluído com sucesso no mesmo commit e pode exigir o SHA autorizado. Empacota código e hashes, constrói as imagens fora da VPS e chama `scripts/publicacao/publicar-vps.mjs`. Este invoca `deploy_vps.py` **da release entregue**. Neste worktree, os scripts ficam em `scripts/publicacao/` e os arquivos Docker em `deploy/`.

O Python confere a imagem anterior informada, a saúde do banco, o pacote e a identidade das imagens novas. Ao ler `_prisma_migrations`, ignora registros revertidos e rejeita migrações não concluídas, duplicadas, ausentes do pacote ou com checksum divergente. Para hashes de migrações já aplicadas, admite finais de linha LF e CRLF. Em seguida calcula a diferença entre os arquivos presentes e os nomes aplicados. **Antes de parar os serviços**, exige que cada pendente pertença à lista nominal. Uma pendente de nome desconhecido bloqueia toda a operação, mesmo com SQL aditivo. O SHA-256 do `deploy_vps_comum.py` lido da release `6437737` na VPS coincidiu com o do Git local.

A mudança acrescenta à lista somente `20261121010000_jornadas_leonel`, `20261122010000_instagram_direct`, `20261122020000_oferta_dezembro` e `20261122030000_recuperacao_entrada_instagram`. Um subconjunto continua válido quando o restante já está aplicado. Os SQLs e seus hashes foram preservados.

O fluxo preserva o backup restaurado antes de iniciar a migração e a recuperação em caso de falha. A versão-base já limitava o comando de migração a **180 s**. A alteração também aplica **`lock_timeout=5s`** na conexão do Prisma, tanto no ensaio do publicador quanto na aplicação real. Esse limite vale para a espera de cada lock e pode falhar antes do prazo do comando. A configuração é específica da conexão e a URL fica no ambiente do subprocesso.

[Workflow](.github/workflows/publicar.yml) · [Transporte](scripts/publicacao/publicar-vps.mjs) · [Lista e checksums](scripts/publicacao/deploy_vps_comum.py) · [Ordem das etapas e recuperação](scripts/publicacao/deploy_vps.py)

### Correção do WhatsApp recuperada

- O registro geral da VPS apontava para `6437737`. O Docker identificou a imagem em execução como `barberos-app:e434997`. O pacote `testes-leonel/card-publicacao-20261123/ajustes.tgz` contém as quatro fontes do WhatsApp e o Dockerfile da Evolution. A revisão do pacote e o `BUILD_ID` da pasta `standalone` conferem com o app ativo. A imagem não continha as fontes TypeScript nem mapas de código nos chunks lidos.
- O diff contra `6437737` acrescenta `previaRoleta` em `convite-app.ts`, `conversas.ts`, `canal.ts` e `evolution.ts`. Os chunks do app ativo confirmam que a Evolution recebe `linkPreview: true` em `sendText` no último balão da roleta. A branch já tinha a página de prévia, a janela para o provedor buscar o cartão e o envio pela Cloud. O porte aproveita essas regras e mantém as autorizações mais novas de conversas e campanhas.
- O pacote anterior `testes-leonel/leonel-frio-automatico-20261123/ajustes-final.tgz` esclarece as dependências ainda presentes no compilado ativo. O modo interno usa o token `rott_`, a campanha de teste pausada e o lote individual. O app ativo usa a arte `previa-roleta-ygor-v1.jpg`, com os mesmos bytes do pacote anterior. A lógica também reconhece a leitura do cartão e permite a primeira ajuda fora do horário apenas nesse teste, quando o acompanhamento estiver habilitado. A rota de gestão continua iniciando o convite comum. A instrução ao Leonel para resolver ou encaminhar pedidos pendentes também está preservada.
- A leitura de `link-preview.js` no container Evolution confirmou a tentativa de gerar a miniatura compacta quando o upload em alta resolução falha. O publicador retoma o container pelo ID e grava no Compose da release a tag local com `pull_policy: never`. A tag precisa apontar para o mesmo ID de imagem instalado. O Dockerfile recuperado registra como reconstruir a adaptação. [Dockerfile da Evolution](deploy/evolution.Dockerfile)

| Comportamento | Situação na branch antes do porte |
| --- | --- |
| Página pública da roleta e prévia na Cloud | Já cobria o link, a arte genérica e o intervalo para montar o cartão antes da confirmação de envio. |
| Cartão na Evolution e arte publicada | Faltavam o pedido de prévia no último balão e a imagem usada em produção. |
| Teste frio interno | Já tinha a jornada comum e os recibos. Faltavam a autorização do dono, a campanha de teste pausada e o tratamento do seu token no link, no giro e no acompanhamento. |
| Imagem da Evolution | O publicador já retomava o container instalado pelo ID. Faltava levar a referência da imagem local para o Compose da nova release. |

<details>
<summary>Lista nominal anterior (50 nomes)</summary>

```text
20261102030000_central_agentes
20261102040000_estudio_templates_roteiros
20261102180000_recrutamento_formularios
20261102190000_recrutamento_revisao
20261102200000_recrutamento_contexto
20261102210000_recrutamento_entrevistas
20261102220000_entrevistas_piloto_whatsapp
20261102221000_piloto_destino_obrigatorio
20261103143000_agenda_externa_transicao
20261103230000_folha_lote_pix_preparacao
20261103233000_link_intencao_pagamento
20261104120000_campanha_equipe_servicos
20261104121000_solicitacoes_horario
20261104121500_solicitacao_horario_periodo
20261104123000_reunioes_avisos
20261104130000_planos_vitrine
20261104131000_avaliacao_mensal_elegibilidade
20261104132000_cobranca_automatica_tentativas
20261104133000_webhook_pagamento_entrada
20261104134000_webhook_pagamento_sequencia
20261104135000_emissao_pix_mensal
20261104140000_optout_contato_antes_cadastro
20261104141000_webhook_pagamento_ordem
20261104223000_cliente_pedidos_login_planos
20261104224000_verificacao_telefone
20261104224500_versao_sessao
20261108010000_adicional_reserva_agenda
20261108011000_identidade_importacao_stone
20261108012000_prova_recebimento
20261108013000_pix_protegido
20261108014000_comissao_geral_unica
20261108015000_remuneracao_vigencias
20261108016000_conciliacao_despesas
20261108017000_recebimento_pendente
20261108018000_evento_pagamento_recuperavel
20261108019000_folha_identidade_congelada
20261108020000_pote_arredondamento_versionado
20261108030000_folha_retificacao_teste
20261108193000_plano_venda_equipe
20261108210000_crescimento_migracao
20261109000000_rh_sem_checklist
20261109220000_antecipado_emissao_segura
20261110000000_whatsapp_oficial
20261110120000_avisos_etiquetas_servicos
20261111120000_assinatura_pagamento_manual
20261115010000_lembrete_agendamento
20261119000100_convite_app_whatsapp
20261119000300_jornada_convite_app
20261120000000_liberar_agenda_comanda_cancelada
20261120001000_indice_envios_por_cliente
```

</details>

### Fonte e restauração

- A cópia mais recente localizada foi `pre-app.dump`, de **23/11/2026 às 00h50**, guardada pela troca anterior do app. O SHA-256 coincidiu entre a VPS, o registro da operação e o arquivo copiado. A cópia rotineira mais recente em `backups/` era de 22/11 às 20h33. A leitura na VPS usou somente arquivos e inventário Docker.
- Restauração local em PostgreSQL **16.16**, mesma versão principal da produção, com `pg_restore --exit-on-error` em cerca de **5 s**. Banco em memória em container Docker dedicado, em rede interna, com acesso do Mac por uma ponte em loopback. O ensaio restaurou o banco. O backup completo de publicação também verifica as mídias e o manifesto.
- Foram conferidos os hashes das **96 migrações** já aplicadas. Só os quatro nomes esperados ficaram pendentes. Após `migrate deploy` e o smoke, as **126 tabelas de negócio preexistentes em `public`** conservaram suas contagens. O schema `public` passou de 127 para 129 tabelas, incluindo o histórico Prisma de 96 para 100 entradas. O schema da Evolution tinha 37 tabelas. As duas tabelas novas ficaram vazias e as colunas novas ficaram nulas nas linhas antigas.
- O cliente Prisma gerado a partir de `6437737` leu os campos escalares dos **126 modelos** com o schema migrado. Essa verificação cobre a referência do banco. Na publicação real, o ensaio do publicador precisa executar a mesma prova com a imagem efetivamente instalada.

| Dados conferidos | Antes | Depois |
| --- | ---: | ---: |
| Clientes | 1.929 | 1.929 |
| Agendamentos | 14.700 | 14.700 |
| Conversas | 332 | 332 |
| Mensagens | 5.109 | 5.109 |
| Envios de campanha | 32 | 32 |
| Jogadas | 91 | 91 |
| Assinaturas | 593 | 593 |
| Comandas | 25.314 | 25.314 |
| Movimentos externos | 19.346 | 19.346 |
| Movimentos de caixa | 5 | 5 |
| Jornadas da roleta | — | 0 |
| Adesões Dezembro Grátis | — | 0 |

### Tempo e locks das migrações

`prisma migrate deploy` 6.19.3, executado com o comando do publicador e sem concorrentes, concluiu em **6,685 s**, incluindo inicialização, conexão pela ponte local e conferência de histórico. `prisma migrate diff --exit-code` concluiu em **3,528 s** sem diferenças. Os tempos individuais são `finished_at - started_at` no histórico do Prisma.

| Migração | Tempo | Tabelas existentes e locks observados | Leitura e escrita |
| --- | ---: | --- | --- |
| `20261121010000_jornadas_leonel` | 11,359 ms | `campanha_envios` com `AccessExclusiveLock`. `clientes`, `agendamentos` e `jogadas` com os locks das chaves estrangeiras. | Em envios, ambas bloqueadas. Nas outras três tabelas, leitura livre e escrita bloqueada. |
| `20261122010000_instagram_direct` | 3,673 ms | `conversas` com `AccessExclusiveLock`, `AccessShareLock`, `ShareLock` e `ShareRowExclusiveLock`. `clientes` com os locks da chave estrangeira. | Em conversas, ambas bloqueadas. Em clientes, leitura livre e escrita bloqueada. |
| `20261122020000_oferta_dezembro` | 4,348 ms | `assinaturas` com os locks da chave estrangeira. | Leitura livre e escrita bloqueada. |
| `20261122030000_recuperacao_entrada_instagram` | 2,940 ms | `mensagens` com `AccessExclusiveLock` e `ShareLock`. | Ambas bloqueadas durante a alteração e a criação do índice parcial. |

Nas tabelas referenciadas por chaves estrangeiras, `pg_locks` mostrou `AccessShareLock`, `RowShareLock` e `ShareRowExclusiveLock`. Entre as tabelas tocadas, agendamentos tinha 7.552 KiB incluindo índices, mensagens 1.960 KiB, clientes 1.088 KiB e conversas 1.040 KiB.

As sondas ocorreram numa cópia separada, mantendo o DDL aberto artificialmente para observar os locks. Cada sonda tentou um `SELECT` ou o lock `ROW EXCLUSIVE` que uma escrita comum toma, com limite de 350 ms. A pausa artificial ficou fora dos tempos acima.

Em outra cópia, mantive o lock de escrita em `campanha_envios` e executei o comando do publicador. O PostgreSQL registrou o timeout **5,002 s** após o início da primeira migração. O comando saiu com falha em **11,788 s** incluindo inicialização e conexão. A tabela permaneceu sem a nova coluna e o histórico reteve uma entrada incompleta. O Prisma mostrou a transação abortada porque essa migração abre uma transação explícita. Em prova sintética separada, uma migração curta sem essa transação retornou `55P03`. No fluxo real, uma falha após iniciar a migração exige recuperação manual mesmo quando o DDL foi revertido.

### Smoke e verificações da branch

- Build standalone candidato que já estava no worktree no começo do ensaio, compilado às 08h35, apontado para a cópia já migrada. O build foi refeito depois nas verificações da branch. Navegador Chromium em perfil temporário. Login real por senha de uma conta sintética criada só no banco do ensaio, removida ao final. O controle sem sessão retornou HTTP 307 na página e 401 na API. Aplicação e navegador passaram por uma prova sintética de bloqueio de tráfego externo, além de rodarem com quarentena, envios e oferta desligados.
- **Agenda, Conversas, Assinaturas e Financeiro (Resultado)** renderizaram no navegador com HTTP 200. As quatro APIs correspondentes responderam HTTP 200 com JSON validado. O navegador registrou zero erros de JavaScript, falhas de API, mutações ou tentativas de acesso externo durante a navegação autenticada.
- `npm run check` passou com lint, regras locais, typecheck, **2.535 testes Vitest** e build Next.js 16.4.6. A suíte padrão pulou 156 testes condicionais em 14 arquivos. O build de verificação usou uma URL de banco sintética e teve o tráfego externo bloqueado.
- `npm run check:publicacao:servidor` passou com **102 testes Node e 192 Python**. A regressão cobre os 16 subconjuntos dos quatro nomes (incluindo a lista vazia), rejeição de nomes extras e propagação do prazo via ambiente.

A cópia do backup, os arquivos temporários e o container do ensaio foram removidos. O diretório privado ficou só com este relatório.

### Validação do porte do WhatsApp

- `npm run check` passou no Linux isolado, incluindo lint, regras locais, TypeScript, **2.547 testes Vitest** e build standalone. Os **158 testes condicionais** passaram em bancos sintéticos dedicados. Essa rodada executou **160 testes** porque repetiu dois da suíte padrão.
- `npm run teste:todos` passou com **28 fluxos e 773 verificações**. Também passaram as verificações de segurança financeira, duração do agendamento e os **10 testes** do worker de vídeo.
- `npm run check:publicacao:servidor` passou com **102 testes Node e 197 Python**. O Docker Compose resolveu o perfil `evolution` com a tag local e `pull_policy: never`. A prova do código de miniaturas reproduziu o arquivo em execução e passou em cinco cenários com tráfego simulado.
- O app compilado respondeu HTTP 200 para o link reservado, para o link confirmado e para o JPEG. Os metadados Open Graph apontaram para a arte com o mesmo SHA-256 do arquivo em uso na VPS. Abrir as páginas deixou a contagem de jogadas em zero.
- As regressões cobrem o último balão da roleta, a preservação do identificador de entrega, as travas do WhatsApp e do Direct, a elegibilidade do teste do dono, a corrida entre giro e mudança de status da campanha e a retirada de um convite vencido da fila. A validação do cartão usa a leitura do compilado ativo, a aplicação local e transporte simulado. A VPS serviu somente como fonte de leitura.
