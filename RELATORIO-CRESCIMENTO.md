# BarberOS — entrega de crescimento

**Data.** 22/11/2026, America/Sao_Paulo. **Branch.** `crescimento/dezembro-20261122`.

A agenda foi entregue primeiro, no commit `dbc09fd`. O Direct e a oferta foram homologados com dados fictícios. Publicação e ativação externa dependem das etapas abaixo.

## 1. Agenda do cliente

A consulta pública de `/api/saude` identificou `6437737`, que contém `919899a`. A abertura anônima preserva `/c/agendar` em `voltar` e abre a entrada por celular. Na primeira abertura pelo navegador, o código da própria página disparou a telemetria sem token. A rota devolveu 204 antes de acessar o banco. A segunda leitura foi feita com as rotas de API bloqueadas no navegador.

No Vercel agent-browser em 390×844, o login com cliente fictício e a troca de uma sessão da recepção chegaram ao resumo **Tudo certo?** após escolher serviço, profissional e horário. A contagem de reservas ficou em zero na base do navegador. O CTA **Já sou cliente · entrar** foi corrigido nesta branch para abrir **Próximos horários** após o login e oferecer acesso à agenda.

O link de produção para o iPhone é [appblackbarber.com/c/agendar](https://appblackbarber.com/c/agendar). O teste autenticado de produção fica com Ygor, seguindo [RESULTADO-AGENDA.md](RESULTADO-AGENDA.md).

## 2. Leonel no Instagram Direct

O webhook verifica o desafio e a assinatura HMAC dos bytes recebidos, valida o perfil destinatário, descarta eco e deduplica por `mid`. O Direct entra em **Conversas** e nas pendências da equipe com canal identificado. A resposta de texto usa `graph.instagram.com` e a janela estrita de 24 h. O modo bloqueado registra a resposta simulada.

Leonel reutiliza o motor de atendimento e as ferramentas públicas. O telefone informado no Direct associa uma ficha ao contato para a equipe. O login é necessário para operações da conta, inclusive dados, cobrança e reserva. O IGSID fica separado da conversa WhatsApp. O fluxo reduz a persistência de contatos e credenciais. Uma entrada interrompida após o aceite fica no histórico e pode ser encaminhada à recepção pela rotina de recuperação, sem repetir um envio incerto.

O webhook local respondeu 200 ao desafio, 403 ao token inválido e 401 à assinatura inválida. Duas entregas concorrentes do mesmo evento responderam 200 e gravaram uma entrada e uma resposta simulada. O vínculo e o rótulo Instagram apareceram na caixa pelo navegador. A conta profissional da Meta e a entrega ao vivo ainda dependem de homologação. [Manual de configuração e App Review](docs/instagram-direct-leonel.md)

## 3. Oferta Dezembro Grátis

O checkout em `/c/dezembro-gratis` é de homologação e exige conta de cliente, cartão de teste e aceite do termo. O painel `/assinaturas/dezembro-gratis` mostra vagas da campanha e do plano-base, adesões e estados. O limite de usos soma os serviços cobertos em dezembro. Serviços excedentes seguem avulsos sem desconto de extras do plano. Prêmios e créditos independentes seguem as regras de cada benefício.

As escolhas para homologação foram pré-adesão a partir de 22/11, bloqueio para contratos em andamento ou encerrados nos últimos 90 dias e uma adesão por cadastro. A vaga da campanha continua computada depois do cancelamento. O cronograma projeta o primeiro débito às 00h de 01/01/2027, seis competências de fidelidade até junho e recorrência mensal posterior enquanto o contrato seguir ativo. A multa simulada usa até uma mensalidade dispensada, proporcional aos ciclos ainda incompletos, com isenção nos sete dias contados do aceite e ao fim da fidelidade. A regra e o termo precisam de aprovação jurídica antes de ativar um caminho real.

Em 390×844, o cliente voltou à oferta após o código, leu o termo, recebeu recusa do cartão fictício `422`, confirmou com o aprovado `201` e cancelou `200`. O banco registrou a versão, o aceite, a presença de IP e agente de usuário e multa simulada de R$ 0,00 no arrependimento. O painel exibiu uma adesão cancelada. As tabelas de cobranças e cobranças simuladas ficaram vazias nesse ensaio. As vagas foram verificadas com concorrência em PostgreSQL.

O código usa Pagar.me para novas recorrências no cartão. A Celcash é a origem dos contratos legados sincronizados e Stone POS é o terminal presencial. A leitura do endpoint de saúde confirma a revisão. A tentativa de consulta de logs pelo Compose padrão em `/opt/barberos` não localizou o serviço do app e não confirmou o provedor configurado por contrato na instância. O adaptador regular de checkout inicia o pagamento, por isso a oferta usa um fluxo separado com projeção em memória e precisa de integração Pagar.me com `start_at` validada no sandbox para efetivar a recorrência. [Regras e pendências da oferta](docs/oferta-dezembro-gratis.md)

## Merge e migrações

O merge `04bd601` integrou `origin/main` em `6437737`. A resolução preservou a abertura de campanha em dois balões da branch e a limpeza do rodapé automático de `origin/main`. O reconhecimento de pedidos de saída continua coberto nos testes.

Migrações a conferir no servidor quando houver autorização de publicação:

- `20261121010000_jornadas_leonel`, herdada da branch-base.
- `20261122010000_instagram_direct`, vínculo e identidade do canal.
- `20261122020000_oferta_dezembro`, adesão e termo da oferta.
- `20261122030000_recuperacao_entrada_instagram`, marcador de processamento e índice parcial.

O banco era PostgreSQL 16 em Docker local. O backup de teste foi restaurado em uma base separada e as migrações foram aplicadas no PostgreSQL descartável. `prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code` conferiu o schema local.

## Testes

- `npm run lint`, `npm run lint:rules` (3 regras), `npm run typecheck` e `npm run build` passaram. O build compilou com Next.js 16.4.6.
- `npm test` passou 2.492 testes em 279 arquivos. A execução padrão deixou 154 testes condicionais para execução por destino de banco.
- Execuções condicionais em PostgreSQL verificaram 156 cenários. Foram 134 dos fluxos de banco preexistentes em 13 arquivos, 10 do Direct e 12 da oferta. O fluxo de agenda do cliente passou 15 verificações.
- `npm run teste:todos` rodou 28 scripts. Passaram 24, com 640 verificações. Os fluxos de crescimento, financeiro, campanhas e evolução/recompra esperam mensagens no simulador e ficaram vermelhos com `WHATSAPP_ENVIOS_BLOQUEADOS=true` desde a rodada anterior à implementação. O ambiente do app preservou a trava e os ensaios usaram rede externa bloqueada.
- Os checks locais de preparação e recuperação de publicação passaram 102 testes Node e 190 Python. O worker de vídeo passou 10 testes.
- Vercel agent-browser 0.43.0 verificou a agenda e o checkout em 390×844, além de Conversas e gestão da oferta. O ensaio de compra confirmou uma adesão simulada, recusa do outro cartão e cancelamento. As contagens das duas tabelas de cobranças ficaram em zero no banco desse ensaio.

## Variáveis novas

- Instagram — `INSTAGRAM_WEBHOOK_VERIFY_TOKEN`, `INSTAGRAM_APP_SECRET`, `INSTAGRAM_PROFESSIONAL_ACCOUNT_ID`, `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_GRAPH_API_VERSION`, `INSTAGRAM_ENVIOS_BLOQUEADOS` e `INSTAGRAM_ATENDIMENTO_IA_PAGA`. Envio bloqueado e IA paga desligada por padrão.
- Dezembro — `OFERTA_DEZEMBRO_MODO`, `OFERTA_DEZEMBRO_PLANO_ID`, `OFERTA_DEZEMBRO_VAGAS` e `OFERTA_DEZEMBRO_LIMITE_USOS`. Novas adesões exigem configuração completa e `AMBIENTE=homologacao`.

## Publicação e decisões do Ygor

1. Testar a agenda no iPhone com uma conta de cliente, até o resumo. A correção da agenda já está na revisão pública. O ajuste da vitrine está na branch.
2. Dar acesso ao app Meta e confirmar a conta profissional, os testers, as permissões, a política de privacidade e o App Review. Autorizar a prova de entrega em ambiente isolado e a liberação de envios separadamente. O Direct pode entrar em uma publicação futura com o bloqueio de envios ligado.
3. Definir plano, vagas e usos por adesão, além do custo e repasse aos barbeiros pelos atendimentos gratuitos. Em dezembro, a oferta gera R$ 0,00 de mensalidade. Para estimar exposição, use vagas × usos e considere o custo variável e o tempo de agenda por serviço.
4. Obter a configuração de sandbox e o plano na Pagar.me. Validar tokenização, início futuro, reconciliação, falha e cancelamento da recorrência. Aprovar a versão do termo, a base da multa, o arrependimento e a retenção das evidências. A contratação real ainda depende de implementação e teste desse adaptador.
5. Para uma publicação autorizada, integrar a revisão aprovada, partir de um checkout limpo e preparar o manifesto com `npm run publicacao:preparar -- /caminho/externo/novo`. Confirmar backup/restauro, comparar migrações pelo manifesto, preservar a imagem anterior, aplicar as migrações confirmadas e conferir saúde e agenda depois da troca. O script legado de produção está bloqueado. O workflow documentado precisa de revisão da lista de migrações antes desta branch. [Procedimento de publicação](docs/publicacao-github.md) · [Backup e recuperação](docs/recuperacao-segura.md)

Os riscos para ativação são a aprovação e o roteamento de conversas da Meta, efeitos de envio com confirmação incerta, a conciliação da recorrência e a política de custo do atendimento grátis. `npm ci` também sinalizou três alertas de severidade alta nas dependências instaladas. As versões ficaram como no lockfile. O arquivo local preexistente `PROMPT.md` foi preservado fora dos commits.

## Commits desta execução

- `04bd601` Integra a versão de produção à branch de crescimento
- `7f5514a` Direciona entrada da vitrine para Meus horários
- `dcf1cd9` Reabre Meus horários após autenticar o cliente
- `dbc09fd` Registra a validação da agenda no celular
- `61e135a` Planeja o Direct do Leonel e a oferta de dezembro
- `4955b38` Prepara dados e configuração do Direct e da oferta
- `a3b83ff` Integra o Direct do Instagram à caixa de conversas do Leonel
- `01733c9` Minimiza os dados de aceite da oferta na exclusão da conta
- `3362800` Aplica regras e limites da oferta de dezembro em homologação
- `647cf42` Entrega checkout simulado e painel da oferta de dezembro
- `ffb6399` Respeita a venda exclusiva da equipe na oferta
- `ae9763e` Protege credenciais e corrige histórico e reenvio no Direct
- `b541cbe` Distingue o Direct e contratos simulados no painel
- `f1e2000` Mostra a oferta de dezembro no app e na gestão
- `b0e3e8c` Isola contratos simulados da conciliação e do atendimento
- `0bd6a1d` Preserva contratos da oferta e isola a apuração financeira
- `6b148c3` Estabiliza os testes de leitura do convite e da roleta
- `dfa9a3b` Mantém a oferta fora do rateio e respeita planos ocultos
- `aa57e98` Documenta as integrações e a entrada da oferta disponível
- `aa4b096` Recupera entradas pendentes do Direct e orienta novas reservas

O commit deste relatório encerra a entrega.

A revisão de integração confirmou, no recorte final, a exclusão de planos ocultos, o isolamento da apuração financeira e a recuperação do Direct no mesmo canal. A revisão restrita terminou sem regressão crítica observada.

## Revisão adicional sugerida

Cinco ciclos pelo cruzamento entre sessão, atendimento e efeito financeiro. Prompt copiável:

> Revise esta branch em cinco ciclos. Confira sessão e destino da agenda no primeiro. Confira webhook, janela, idempotência e LGPD no segundo. Confira quotas, cobertura e cancelamento no terceiro. Confira conciliação, cronograma e folha no quarto. Confira migrações, backup e integração no quinto. Rode lint, typecheck, Vitest, build e os testes PostgreSQL documentados, com efeitos externos bloqueados e dados fictícios. Registre evidências e riscos residuais.
