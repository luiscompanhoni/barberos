# Leonel da Black

Branch `melhoria/leonel-20261121`, criada sobre `origin/main` em `af9fc8d`. Os textos de treinamento, atendimento e vendas do Leonel serviram de referência para as novas mensagens.

## O que mudou

- A temperatura usa o último atendimento concluído. **Quente** até 30 dias, **morno** de 31 a 90, **frio** de 91 a 180 e **muito frio** acima de 180. As chaves antigas de seis meses a um ano e mais de um ano continuam disponíveis como subdivisões para preservar as campanhas salvas.
- A campanha começa com dois balões. O texto da oferta e o link rastreado ficam para depois de uma resposta direta, como “Oi, Leonel” ou “Pode mandar!”. Dúvidas e casos em que a oferta ficou indisponível vão para a recepção. Se a pessoa estiver fria ou muito fria, a campanha precisa ter uma roleta ativa vinculada. O link abre a roleta pública diretamente.
- A saída continua aceitando `PARAR`, `SAIR`, `não quero mais` e variações previstas. Sob bloqueio, a entrada fica em **Conversas**, na fila de atendimento humano. A restrição do canal continua valendo. Na Cloud API, um webhook que chega atrasado preserva a hora de envio do cliente. Uma entrada fora de ordem fica registrada e preserva o turno mais recente. Um pedido de saída atrasado continua valendo.
- O giro e a vitória iniciam os marcos da trilha. O vínculo com a agenda dá prioridade à reserva que usa o prêmio. O lembrete, a presença e o pós-corte ficam no mesmo percurso, inclusive ao medir avisos legados que já estavam habilitados. A visita concluída volta a alimentar a temperatura.
- Em **Campanhas > Funil da roleta**, a gestão filtra pela data do giro e vê quantos avançaram, a conversão e a perda entre etapas. O agendamento após resposta é atribuído à mesma jogada. A base usa jogadas e apresenta também o total de clientes distintos.

## Exemplos de mensagem

| Momento | Mensagem |
| --- | --- |
| Abertura, primeiro balão | Fala, João! |
| Abertura, segundo balão | Aqui é o Leonel da Black. |
| Saída, ao fim da oferta | Se preferir que eu pare de mandar esses recados, é só responder SAIR. |
| Depois de ganhar e parar | Ô irmão, tudo bem? Vi que tu não deu continuidade depois da roleta. Quer uma mão pra marcar? |
| Resposta positiva à retomada | Bora! Tu consegue escolher teu horário por aqui 👇 [link para agendar] |
| Véspera do corte | Oi, João! Passando pra lembrar: amanhã tu tem Corte com Pedro na Black. Responde *SIM* pra confirmar ou me avisa se precisar remarcar. |
| Depois do corte | Valeu por vir na Black! Quando quiser marcar o próximo corte, é só chamar aqui. 💈 |
| Oferta opcional | Quer já deixar teu próximo corte marcado? Se quiser, te ajudo a ver um horário. |

## Ativação da trilha

Em uma instalação já autorizada para enviar, configure as variáveis da aplicação. Os exemplos de ambiente já incluem os padrões.

| Variável | Padrão | Efeito |
| --- | --- | --- |
| `WHATSAPP_ROLETA_ACOMPANHAMENTO_ATIVO` | `false` | `true` permite a tentativa de retomada e o pós-corte da jornada. |
| `WHATSAPP_ROLETA_NUDGE_HORAS` | `4` | Horas após o prêmio para considerar uma retomada, entre 1 e 168. |
| `WHATSAPP_ROLETA_UPSELL_ATIVO` | `false` | `true` habilita a oferta opcional quando a trilha está ativa. |

A retomada tenta uma vez por jornada, com intervalo de 14 dias por cliente, e respeita as preferências de contato, a equipe e o horário comercial de 8h a 21h. Na Cloud API, nudge e upsell exigem uma entrada do cliente nas últimas 24 horas. O lembrete usa as antecedências da agenda. O agradecimento entra entre 30 minutos e 12 horas após a conclusão, durante o horário comercial. Fora da janela da Cloud API, lembrete e agradecimento dependem do modelo de utilidade configurado para o aviso. Um aceite claro, como “Sim, pode marcar!”, registra interesse e encaminha à recepção sem agendar ou cobrar automaticamente.

O primeiro upsell oferece deixar o próximo corte marcado. Ideias para futura oferta incluem recomendar um plano pelo ritmo de visitas ou um produto usado no atendimento, após conferir perfil, preço e disponibilidade. Essas ideias precisam de texto, produto e gatilho aprovados separadamente.

Para campanhas via Cloud API fora da janela, associe dois modelos de marketing em `pt_BR` aprovados, com nomes distintos e sem link. A saudação usa corpo `Fala, {{1}}!`, configurado em `WHATSAPP_TEMPLATE_CAMPANHA_SAUDACAO`. A apresentação usa corpo fixo `Aqui é o Leonel da Black.`, configurado em `WHATSAPP_TEMPLATE_CAMPANHA_APRESENTACAO`. O modelo pode oferecer resposta rápida `SAIR`. Confirme o consentimento dos destinatários, inclusive nas fichas antigas, e os textos aprovados antes de liberar um lote. A autorização de contato, a janela de atendimento e os pedidos de saída seguem as regras do canal. [Política de mensagens do WhatsApp](https://whatsappbusiness.com/pt-br/policy/)

## Auditoria dos links

Base `af9fc8d` da branch `melhoria/leonel-20261121`. Análise estática das origens, Proxy do Next.js, login, páginas e serviços, seguida de navegação anônima no ambiente sintético `127.0.0.1:3182` com Vercel agent-browser 0.43.0. Durante a checagem inicial, o navegador bloqueou `/api/**` para evitar registro de visitas, códigos de acesso e outras escritas. Tokens de exemplo inexistentes testaram a recusa de acesso. Os tokens de clientes, provedores e configurações reais ficaram fora da execução.

| Link/origem | Destino rastreado na base | Resultado inicial |
| --- | --- | --- |
| `{link}` em modelos de segmento e modelos padrão de jogo e vaga. Emitido por `processarCampanhas` e reproduzido pelo lote autorizado. | `/c/r/{tokenCampanha}` abre o jogo público vinculado, inclusive a roleta diretamente. Sem jogo, registra o clique e segue à agenda. Ações interativas usam `/api/r/{token}`. | Token fictício retornou 404. Modelos de frios podiam apontar à agenda e a campanha podia usar caixa ou raspadinha. O link e a oferta eram enviados na primeira mensagem. |
| `/c/r/{tokenCampanha}` na consulta de presentes do bot | Direciona a um convite de jogo que consta na ficha do cliente e passa pelas mesmas verificações públicas. Link de prêmio anterior abre o resultado. Link vencido ou jogo suspenso oferece a agenda. | As condições de validade e o vínculo ao destinatário eram verificados no código. |
| `/c/agendar` (fallback legado sem token, campanha comum e prêmio de crédito) | Agenda para cliente autenticado. Sem sessão, login com confirmação por código e retorno à agenda. | Redirecionamento observado no navegador. |
| `/c/agendar?premio={id}` (CTA da landing/modal de resultado) | Seleção de horário com prêmio válido já aplicado à seleção. O OTP vincula o usuário à ficha do telefone existente e a agenda consulta o prêmio pelo cliente autenticado. | O navegador manteve `premio` no parâmetro `voltar` da autenticação. O percurso autenticado está na verificação abaixo. |
| `/c/entrar?convite=app_…` e alias `/c/r/app_…` | Convite individual do app abre login por código e segue à agenda. A imagem da prévia é `/brand/black/previa-app-v1.png`. | Aliases e página abriram. A imagem respondeu 200. O token de URL usado era sintético e não foi registrado. |
| `/c/entrar?confirmar=1` (convite genérico) | Formulário por código. O retorno padrão do acesso geral a `/c` é a tela autenticada da roleta. | Formulário abriu. O convite individual já possui retorno específico para a agenda. |
| `appblackbarber.com` (fallback do atendimento com IA desativada) | Link literal para a raiz. O site separado reescreve a raiz para a vitrine. Em instalação de domínio único, a raiz é do painel. | Destino não condiz com a orientação de agendar. |
| `/c` (bot de remarcação em grupo) | Cliente autenticado chega a Meus horários, com botão Remarcar. Depois de login, o retorno genérico `/c` vai para a roleta. | Remarcação perde o destino se o cliente está fora da conta. |
| `/c/premios` (consulta de presentes) | Meus prêmios, com autenticação e retorno preservado. | Abertura por código observada. O acesso autenticado foi mapeado no código. |
| `/c/roleta` e `/c/jogos/roleta` (atalho legado e roleta do cliente) | O caminho antigo redireciona para a roleta autenticada. | Os dois caminhos abriram o login com retorno à área do cliente. |
| `/c/planos` (ferramentas de assinatura) | Área autenticada de planos e mensalidades. | Entrada por código com retorno preservado. |
| `/c/pagar-horario/{id}` (pagamento antecipado via bot) | Checkout do horário avulso do cliente, com verificação de titularidade após login. | Entrada por código com retorno preservado para ID fictício. |
| `/c/pagar/{token}` (mensalidade existente e cobrança automática) | Fatura Pix ou boleto do sistema. Quando aplicável, segue à URL da cobrança externa. | A rota pública devolveu 404 para token fictício. |
| `/c/assinar/{token}` (nova assinatura, atualização de cartão) | Checkout de assinatura/cartão, ou fatura vigente em `/c/pagar/{token}`. | A rota pública devolveu 404 para token fictício. |
| `/c/link/{token}` (link de cobrança da comanda) | Checkout do pedido vinculado ao token. | A rota pública devolveu 404 para token fictício. |
| `/c/pagamento-simulado/{id}` (gateway de teste) | Pagamento no simulador. | A rota pública devolveu 404 para ID fictício. O teste não emitiu cobrança. |
| URLs de Celcash/Asaas e outros gateways derivadas da cobrança vigente | Destino devolvido pelo provedor e autorizado pelo fluxo correspondente. | Origem e verificação mapeadas no código. O destino real é dinâmico e depende de cobrança que o teste não emitiu. |
| `/c/avaliacoes` (convite e reenvio de avaliação) | Avaliação interna, com login e retorno preservado. | Entrada por código observada. |
| `linkAvaliacao` (pós-atendimento de automações) | Avaliação externa configurada pela barbearia. | O endereço é configurável. O valor de produção ficou fora do ensaio. |
| `/i/{codigo}` (indicação) | Valida o código, grava cookie de indicação por 30 dias e manda a `/`, que em domínio separado vira `/assine`. | Em domínio único, a raiz caiu no login do painel. `/assine` abriu a vitrine esperada no navegador local. |
| `/indicadores` e `/meu-financeiro` (ferramentas da equipe) | Painel, com encaminhamento por papel para indicadores ou financeiro pessoal. | Abertura do login com retorno preservado. |
| `/t/{token}`, `/checklist`, `/financeiro?aba=estornos` (avisos internos) | Checklist individual, checklist de gestão e aba de estornos. | Token fictício retornou 404. As rotas de gestão encaminharam ao acesso da equipe. |
| `/entrevistas#{token}` (fluxo de recrutamento tratado pelo bot) | Página pública de confirmação. O fragmento mantém o token fora da requisição de página. | Página abriu com fragmento fictício e chamadas desabilitadas. |
| `https://exemplo.test/agendar` e destinos UTM da demo de rotas | Endereço sintético de demonstração e destinos editáveis no construtor. | A demo não dispara campanhas. URLs editáveis não têm destino universal. |

Rotas de webhook, APIs de provedor e processamento de mídia são tráfego interno. As instruções do bot restringem envio de endereços às ferramentas e à configuração conhecida.

### Verificação após as correções

Vercel agent-browser 0.43.0 com Chromium portátil, código em cópia local isolada na porta 3183 e PostgreSQL 16 `leonel_browser_descartavel`. Configuração carregada em ambiente limpo, com WhatsApp/Pagamentos/Push simulados e envios bloqueados.

- O link rastreado liberado abriu diretamente a roleta pública, sem autenticação. Girar mostrou o brinde e a ação **Agendar para utilizar**. A agenda manteve o ID do prêmio na volta após a autenticação por código. A ficha sintética, que não tinha usuário, passou a ter uma conta vinculada e entrou sem solicitar senha, formulário completo ou instalação.
- O navegador exibiu **Usando o prêmio**. Ao escolher serviço, disponibilidade e confirmar, mostrou **Seu horário está agendado**. No banco, o prêmio ficou **RESERVADO** com vínculo à reserva e a campanha registrou clique e giro. O link **Pagar agora** do horário abriu o checkout local correto, sem emissão de Pix ou pagamento.
- O destino `/c?aba=horarios` exibiu **Remarcar** com a sessão existente. Em outra sessão de navegador, pediu o código e voltou ao mesmo destino, exibindo a ação. O acesso geral a `/c` continua com o destino padrão de roleta após login.
- Com código fictício de indicação registrado, `/i/{codigo}` abriu a vitrine `/assine` também no domínio único.
- O GET de campanha aguardando continuação devolveu 404. O POST sintético de visita foi ignorado pelo filtro e deixou clique vazio. Com o motor integrado, o POST de giro também devolveu 404. O banco confirmou ausência de clique e de jogada. Um link legado de campanha comum continuou registrando visita e abriu a agenda com a sessão disponível.
- Com conta autenticada, `/c/planos`, `/c/premios` e `/c/avaliacoes` acessaram a área correta, e o alias `/c/roleta` redirecionou a `/c/jogos/roleta`.
- 32 testes focados passaram em `login-destino.test.ts`, `leonel-links.test.ts` e `jogos-vitrine.test.ts`. ESLint dos arquivos da correção e `git diff --check` também passaram.

O fallback de agendamento agora aponta para `/c/agendar` no domínio configurado. O link da roleta conta a validade a partir da oferta. O token só pode ser reutilizado pela consulta de presentes após confirmação do envio. No painel, o navegador também conferiu o rótulo de clientes frios, a prévia dos dois balões e o filtro que alternou uma coorte de 30 dias com um período de 7 dias vazio. Em viewport de 390 px, as tabelas ficaram dentro da largura da tela.

## Testes executados

- `npm run check` em cópia com ambiente isolado. ESLint, regras locais, geração de tipos, TypeScript, 2.444 testes do Vitest e build Next.js passaram. A execução padrão deixou 124 testes condicionais fora. Os 20 testes novos da jornada foram executados separadamente com PostgreSQL.
- `tests/jornada-roleta-banco.test.ts` habilitado no PostgreSQL descartável, com WhatsApp simulado e rede de gateway bloqueada. Os 20 casos cobrem giro com e sem prêmio, nudge, resposta pelo bot, reserva com prêmio, lembrete, status de comparecimento, agradecimento, serviço adicional, upsell, recusas e concorrência.
- `scripts/teste-campanhas.ts` em banco descartável novo. Foram 49 verificações de dois balões, resposta, links, opt-out, lotes, bloqueios e continuidade na recepção. O teste usa o mesmo processador de entrada do WhatsApp e um transporte simulado.
- `scripts/teste-automacoes.ts`, `scripts/teste-jogos.ts` e `scripts/teste-bot-banco.ts` em bases descartáveis separadas. Cobre regressões de agenda, lembretes, jogos, assinaturas e permissões. O teste do bot usa modelo roteirizado e bloqueia rede externa.
- Vercel agent-browser com Chromium e dados sintéticos. A revisão da Cloud API conferiu o formato dos modelos e a janela por testes simulados. A aprovação dos modelos e os destinos externos dinâmicos ficam para a prévia autorizada.

## Banco e preparação para publicar

- Migração aditiva `20261121010000_jornadas_leonel`. Cria `jornadas_roleta` e acrescenta campos opcionais a `campanha_envios`. Dados anteriores não foram reclassificados ou preenchidos retroativamente.
- Em PostgreSQL 16 descartável, restaurei um `pg_dump` com campanha e envio legados, apliquei a migração, executei o rollback SQL e reapliquei a migração. O ensaio também injetou erro no meio do SQL. A transação desfez as alterações parciais. O schema esperado bateu sem diferenças nas comparações. O envio legado foi preservado, com os campos novos nulos.
- O backup da pasta antiga em `Projetos/_arquivo/BarberOS-antigo-20261121.tar.gz` passou por SHA-256, teste gzip, extração completa e comparação de conteúdo com a origem. A pasta foi movida para `Projetos/_arquivo/BarberOS-antigo-20261121`, com as alterações locais e o README de referência. Os ponteiros Git das cópias vinculadas foram reparados após a mudança.
- Antes de publicar, validar o commit instalado e o CI Linux. Fazer backup recente de banco, configuração e mídias, restaurar numa instalação isolada e conferir os registros e jornadas. Preparar uma prévia com remetente simulado, passo a passo da roleta até o pós-corte, e revisar os dois balões e textos finais com Ygor. Publicação e liberação de um lote precisam de autorização própria.
- Em recuperação, parar escritores e manter os envios bloqueados. Preservar as colunas aditivas se a versão anterior for compatível. Se precisar removê-las, exportar os eventos novos antes de qualquer rollback e tratar o histórico de migrações com a recuperação aprovada. O SQL de rollback foi executado somente no banco descartável.

## Sugestão de revisão para a publicação

Quatro rodadas cobrem as interações entre transporte, agenda, dados e interface. Prompt copiável

> Revise em 4 rodadas. 1. Consentimento, filas, concorrência, templates e janela da Cloud API. 2. Giro, vínculo com prêmio, lembrete, presença e pós-corte. 3. Migração, recuperação, dados legados e funil por período. 4. Integração da branch e riscos residuais. Rode `npm run check`, o fluxo de campanhas e a suíte da jornada em PostgreSQL descartável, e confirme a prévia no Vercel agent-browser. Use somente transportes simulados.
