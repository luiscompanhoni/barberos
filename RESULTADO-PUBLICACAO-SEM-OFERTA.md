# BarberOS para publicação sem Dezembro Grátis

Preparado em 23/11/2026, horário de São Paulo. Branch local `publicacao/sem-oferta-20261123`, criada em `962f8d7`. A branch `crescimento/dezembro-20261122` permanece em `962f8d7`, com a oferta disponível no fluxo de homologação original. A referência publicada informada é `origin/main` em `6437737`.

## Commits

- A branch herda os 39 commits entre `6437737` e `962f8d7`. As entregas incluem o Direct em `a3b83ff`, recuperação e orientação para a agenda em `aa4b096`, login do Facebook em `443eaa1`, campanha e jornada da roleta em `f6064d1` e retorno do cliente em `7f5514a` e `dcf1cd9`.
- `2ef0d05` desativa a oferta por padrão, fecha as páginas e a API e oculta contratos simulados nas telas comuns.
- `c97e2b1` isola contratos simulados nos fluxos operacionais e preserva a reserva de vagas de contratos regulares.
- `3ed75cd` restaura para Assinaturas as abas salvas que apontavam para a oferta.
- `ad9d128` completa o isolamento de vagas de troca, vitrine e indicações e atualiza dois roteiros de regressão herdados.
- O commit que contém este relatório registra a validação da publicação local. Para listar todo o histórico da entrega, use `git log --oneline 6437737..HEAD`. [Plano](docs/superpowers/plans/2026-11-23-publicacao-sem-oferta.md)

## Efeito para clientes e equipe

- **Clientes.** O acesso pela vitrine abre **Meus horários** após o login. Links da agenda preservam o destino após autenticação. Os planos comuns seguem disponíveis e a promoção fica ausente da vitrine, dos planos, da agenda e do cancelamento. Se um banco local contiver um contrato simulado anterior, a área de planos orienta o titular a conferir o cadastro com a recepção e preserva a trava contra nova contratação sobre o mesmo cadastro. [Validação da agenda herdada](RESULTADO-AGENDA.md)
- **Equipe.** A caixa de Conversas identifica o Direct, o vínculo informado e os envios simulados. O modo padrão usa o login do Facebook e o token de página, valida a assinatura do webhook e recupera entradas pendentes. O Leonel reaproveita a base de conhecimento já presente em `6437737` para consultas públicas e para encaminhar novas reservas à agenda. As melhorias herdadas de campanhas incluem indicadores de interesse, funil da roleta, rastreio e preservação do opt-out. A gestão fica sem atalho, painel e contagens da oferta. [Direct](RESULTADO-DIRECT-LOGIN-FACEBOOK.md) · [Leonel](RELATORIO-LEONEL.md)
- **Assinaturas e apuração.** A trava suspende adesão, cancelamento e encerramento automático específicos da oferta e seu benefício na agenda. Mantém os filtros que isolam contratos simulados de rateio, comissões, conciliação e indicadores. Vagas, migração de assinaturas, saldo e segmentação comuns ignoram contratos simulados no escopo das novas guardas. A reserva de vaga para pendências regulares do plano-base em homologação permanece válida. Os dados de aceite permanecem disponíveis ao titular pelo fluxo LGPD.
- **Acesso direto.** `/c/dezembro-gratis`, `/assinaturas/dezembro-gratis` e `/api/cliente/oferta-dezembro` respondem 404 quando a oferta está fechada, inclusive sem sessão e antes de processar a solicitação. URLs com barra final passam pela normalização padrão do Next e terminam em 404. [Configuração da oferta](docs/oferta-dezembro-gratis.md)

## Configuração

| Variável | Comportamento nesta entrega |
| --- | --- |
| `OFERTA_DEZEMBRO_ATIVA` | Única flag nova sobre `962f8d7`. Ausente, `false` ou inválida, fecha a oferta. Somente `true` com `AMBIENTE=homologacao` permite acesso. A leitura é em runtime e o app deve ser reiniciado ao mudar a configuração. |
| `OFERTA_DEZEMBRO_MODO`, `OFERTA_DEZEMBRO_PLANO_ID`, `OFERTA_DEZEMBRO_VAGAS`, `OFERTA_DEZEMBRO_LIMITE_USOS` | Herdadas da branch de crescimento. Servem ao checkout de homologação, que também exige plano elegível e período de adesão aberto. Limpar o modo mantendo a flag ligada suspende novas adesões e permite operar contratos simulados anteriores. |
| `INSTAGRAM_PROVEDOR`, `INSTAGRAM_GRAPH_API_VERSION` | Herdadas em relação à produção. Provedor padrão `facebook_login`. A versão é configurável. |
| `INSTAGRAM_WEBHOOK_VERIFY_TOKEN`, `INSTAGRAM_APP_SECRET`, `INSTAGRAM_PROFESSIONAL_ACCOUNT_ID`, `INSTAGRAM_PAGE_ID`, `INSTAGRAM_PAGE_ACCESS_TOKEN`, `INSTAGRAM_ACCESS_TOKEN` | Configuração privada nova em relação a `origin/main`. Usar token de página no padrão Facebook. O token alternativo serve a configurações compatíveis do Instagram Login. |
| `INSTAGRAM_ENVIOS_BLOQUEADOS`, `INSTAGRAM_ATENDIMENTO_IA_PAGA` | Envios simulados por padrão, inclusive se a flag de bloqueio estiver ausente. Homologação e quarentena também forçam simulação. IA paga exige liberação explícita e continua desligada por padrão. |
| `WHATSAPP_ENVIOS_BLOQUEADOS`, `WHATSAPP_ATENDIMENTO_IA_PAGA` | A configuração aplicada pelo publicador conserva `true` no bloqueio e `false` na IA paga. Sob bloqueio, o código herdado encaminha entradas para a equipe. O OTP solicitado pelo usuário conserva a exceção existente. Nenhum valor privado da VPS foi consultado. |
| `WHATSAPP_TEMPLATE_CAMPANHA_SAUDACAO`, `WHATSAPP_TEMPLATE_CAMPANHA_APRESENTACAO` | Substituem o template único de abertura de campanhas Cloud fora da janela. Precisam de dois templates aprovados se o canal for liberado no futuro. |
| `WHATSAPP_ROLETA_ACOMPANHAMENTO_ATIVO`, `WHATSAPP_ROLETA_UPSELL_ATIVO`, `WHATSAPP_ROLETA_NUDGE_HORAS` | Acompanhamento e upsell ficam desligados por padrão. A espera padrão do acompanhamento é de quatro horas. |

## Migrações Prisma

As quatro migrações adicionam schema e preservam o SQL anterior. O ensaio em PostgreSQL 16 partiu das 96 migrações de `6437737`, inseriu dados fictícios nas tabelas afetadas e aplicou as quatro restantes. O status Prisma confirmou 100 migrações e o diff do schema ficou vazio. A comparação preservou a assinatura regular, a conversa, a mensagem e o envio de campanha. Colunas novas ficaram nulas nas linhas antigas. Tabelas novas começaram vazias. O catálogo confirmou o índice parcial e as restrições da oferta.

| Migração | Compatibilidade e riscos de aplicação |
| --- | --- |
| `20261121010000_jornadas_leonel` | Adiciona seis colunas opcionais a `campanha_envios` e cria `jornadas_roleta` com seus vínculos e índices, em transação. A alteração e a criação dos vínculos podem aguardar locks. |
| `20261122010000_instagram_direct` | Adiciona IGSID e vínculo opcional em `conversas`, com índices e chave estrangeira. IGSIDs nulos preexistentes são compatíveis com o índice único. A criação dos índices e a validação da chave exigem janela de manutenção compatível com o volume. |
| `20261122020000_oferta_dezembro` | Cria `oferta_dezembro_adesoes` vazia com checks, idempotência e FK de assinaturas. Não insere contratos, benefícios ou cobranças. A relação mantém o isolamento de simulações com a oferta fechada. |
| `20261122030000_recuperacao_entrada_instagram` | Adiciona coluna opcional e índice parcial em `mensagens`, em transação. O índice faz uma varredura da tabela enquanto a transação mantém o lock da alteração. Mensagens antigas permanecem fora da fila de recuperação. |

O SQL é aditivo e compatível com os dados existentes. A duração dos locks com volume real segue por validar em uma restauração isolada antes de publicar. [PostgreSQL 16 ALTER TABLE](https://www.postgresql.org/docs/16/sql-altertable.html) · [PostgreSQL 16 CREATE INDEX](https://www.postgresql.org/docs/16/sql-createindex.html)

## Testes

- **`npm run check`.** Lint, regras locais, tipos, Vitest e build standalone do Next.js 16.4.6 passaram sobre `ad9d128`. A suíte padrão aprovou 2.535 testes em 280 arquivos. Os casos condicionados à execução com banco foram habilitados em rodada própria.
- **PostgreSQL.** As 15 suítes habilitadas passaram 158 testes. Incluem oferta, preservação de vagas, webhook e recuperação do Direct, roleta, agenda, retenção de dados e regressões financeiras. Passaram também os roteiros dedicados de segurança, Pix, vigências, duração de reserva e bot.
- **`npm run teste:todos`.** Passaram os 28 fluxos, com 773 verificações. Os processos de fluxo rodaram em um contêiner com acesso restrito ao loopback e bases descartáveis. Testes que esperam entregas locais usaram o simulador em memória ou no banco. Pagar.me usou um transporte falso e o bot usou um modelo roteirizado. Os roteiros de campanha e bot agora verificam o texto original de campanha e o comportamento vigente para cartão sem cobrança aberta.
- **Navegador.** Vercel agent-browser 0.43.0 em Chromium, viewport 390 × 844, sobre o mesmo build `ad9d128` em três configurações. Em homologação com flag desligada e com flag ligada fora de homologação, a oferta ficou invisível nos pontos de entrada públicos, planos, agenda, saldo e gestão. A aba antiga foi restaurada para Assinaturas. Páginas e API responderam 404 com e sem sessão. Foram verificados GET, HEAD, OPTIONS, POST, PATCH, DELETE e PUT na API. Em homologação com flag ligada, os links levaram ao termo, ao contrato existente e ao painel de adesões. A conversa fictícia do Direct exibiu o canal e o envio simulado nos três cenários.
- **Checks complementares.** Passaram 102 testes Node e 190 Python de preparação e recuperação de publicação, dez testes do worker de vídeo e `git diff --check`.

## Riscos e pendências de publicação

- O publicador vigente rejeita as quatro migrações na lista nominal antes de parar a aplicação. Uma publicação futura requer revisão dessa lista, ensaio de duração e recuperação com backup restaurado e autorização de deploy. A branch está preparada e verificada localmente. [Guarda de migrações](scripts/publicacao/deploy_vps_comum.py) · [Recuperação](docs/recuperacao-segura.md)
- O Direct real depende de configurar o aplicativo e as permissões na Meta, ensaiar a recepção com testers e concluir App Review. Hoje o evento de mensagem desfeita é descartado e uma cópia gravada pode permanecer. Os ensaios locais usam dados sintéticos. [Roteiro da Meta](docs/instagram-direct-leonel.md)
- Autorizações antigas de lotes podem precisar ser refeitas pelo novo protocolo de dois balões. O acompanhamento da roleta e o Direct usam suas próprias travas de envio. [Operação do Leonel](RELATORIO-LEONEL.md)
- A ativação comercial da oferta requer Pagar.me, validação do termo e da operação real. O toggle disponibiliza apenas o ensaio de homologação. [Pendências da oferta](docs/oferta-dezembro-gratis.md)

Nenhum push, deploy, acesso à VPS ou envio externo foi realizado.
