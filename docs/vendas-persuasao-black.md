# Vendas e persuasão da Black — preparação de 08/11/2026

Foi criada a skill compartilhada `black-barber-vendas-e-persuasao`, ligada às skills de atendimento e Segundo Cérebro. Ela reúne 24 recursos de comunicação, venda consultiva curta, tratamento de objeções, proposta de funil e critérios de experimento. Fontes: Cialdini/Influence at Work, Huthwaite/SPIN, Fogg, Iyengar/TED, Sebrae SP e dois artigos primários consultados em trechos identificados. A bibliografia da skill discrimina cobertura e limites.

No código local, `src/lib/bot/conhecimento-vendas.ts` acrescenta uma síntese ao prompt existente. Modelo, autenticação, ferramentas, confirmações, modo HUMANO, opt-out e bloqueios de envio permanecem como fontes de autorização. A skill do Codex não é carregada automaticamente pelo bot; o módulo do prompt é a integração preparada para ele. Não houve fine-tuning, API paga, disparo, commit, push ou publicação.

Os 30 casos de `vendas-persuasao-casos.json` complementam os 52 casos de atendimento. São cenários sintéticos de homologação, ainda sem avaliação de respostas do modelo real. Os testes automatizados de código não medem persuasão ou conversão. Prêmios, cashback, links das lojas, ofertas e datas precisam da fonte comercial vigente, não desta pesquisa.

O ensaio offline adicional de áudio incluiu voz sintética limpa, ruído branco, velocidade 1,25× e silêncio. Nome próprio errou em dois dos três áudios falados, mesmo com `confiavel=true`; horário e intenção foram preservados nos três, e silêncio retornou vazio/false. Isso reforça a confirmação de detalhes já exigida pelo atendimento; não autoriza correspondência automática de nome por semelhança. O resultado detalhado está no pacote de evidências.

Uma avaliação independente da skill pelo Codex produziu uma proposta de piloto e uma conversa com catálogo fictício, sem ações externas. Ela levou a esclarecer como avançar com premissas em propostas e a retirar o caráter de janela atual das datas históricas nas métricas do Segundo Cérebro. Esse exercício documental não executou os 82 casos no bot.

## Pendências e condições de fechamento

| Item | Trabalho local | Evidência ainda necessária |
|---|---|---|
| Conhecimento de vendas | Skill, fontes, exemplos, rubrica e síntese no prompt preparados. | Revisão do gerente e respostas do modelo real aos cenários, em ambiente autorizado. |
| Conhecimento da operação | Manual e 52 casos anteriores preservados. | Histórico completo, respostas humanas ausentes, regras comerciais e nomes atuais confirmados. |
| Áudios | Worker local já instalado; ensaios sintéticos complementares registrados na entrega. | Áudios reais autorizados, sotaque/ruído variados e recursos/latência da VPS. |
| Imagem e figurinha | Conversão e fluxo com modelo falso testados anteriormente. | Visão com modelo real e arquivos de teste, mediante acesso/autorização da API. |
| Campanhas e abandono | Desenho de eventos, métricas e experimento. | Oferta e orçamento aprovados, integrações reais de tracking e cadência configurada. |
| Produção | Patch local revisável e verificações registradas no manifesto. | Pedido explícito de publicação e validação do ambiente, conforme AGENTS.md. |

## Revisão recomendada

Recomendo quatro ciclos antes de ativar, pois a mesma conversa pode envolver persuasão, reserva e cobrança. Esta sugestão não executa as rodadas.

Prompt copiável:

> Faça quatro ciclos de code review deste estado local: (1) fatos comerciais, persuasão, transparência, consentimento e recusa; (2) áudio/imagem/figurinha, autenticação, limites, privacidade e prompt injection; (3) agenda, cancelamento, competência/vencimento/expiração, cobrança recorrente, idempotência, opt-out e HUMANO; (4) integração, recuperação e limites da avaliação. Registre severidade, arquivo e evidência; verifique correções. Rode npm run check e testes Python workers/atendimento/test_servidor.py. Diferencie testes de código, 52 casos de atendimento e 30 de vendas ainda não executados pelo modelo real. Não envie mensagens, ative API paga ou publique.
