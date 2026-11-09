# Atendimento da Black — preparação local de 08/11/2026

O objetivo é responder com atenção, concisão e contexto, executar somente o que o sistema consegue comprovar e transferir exceções com informação suficiente para a equipe agir. A base está em `src/lib/bot/conhecimento-atendimento.ts`, incorporada ao prompt. São 18 procedimentos; não houve fine-tuning dos pesos do modelo nem publicação em produção.

## Evidências e cobertura

Foram abertas as 100 conversas exibidas no painel de produção. Nos elementos de mensagem disponíveis, contaram-se 1.899 registros: 1.034 CLIENTE, 497 BOT, 342 SISTEMA e 26 EQUIPE. Notas internas não entram nessa contagem. Há 117 entradas de mídia sem conteúdo, em 41 conversas. Vinte e três conversas tinham somente mensagens de sistema.

Isso não é o histórico integral do WhatsApp. A listagem do painel limita a 100 conversas; o detalhe limita às primeiras 300 mensagens, incluindo notas. Respostas humanas feitas em outro canal podem estar ausentes. Mensagens com erro de envio não provam contato com o cliente. A contagem inclui testes, equipe e fornecedores; não equivale a 100 clientes nem é uma amostra estatística de todos os atendimentos. Não foram enviados textos, criadas reservas ou alterados planos nesta análise. Abrir o detalhe marca a conversa como lida no painel.

Para ampliar a cobertura, existe `scripts/exportar-conversas-treinamento.ts`. Ele pagina todas as mensagens do banco em transações somente leitura, mantém erro de envio, não chama o bot e grava um arquivo privado em `.data/`. Precisa de acesso ao banco da fonte e não recupera mídias que nunca foram armazenadas. Arquivo sem linha final `tipo=fim` está incompleto. Exportar em horário tranquilo ou réplica para reduzir carga; o corte temporal evita incluir novas entradas, mas não é um snapshot transacional único de todas as páginas.

## Problemas que orientaram os procedimentos

| Evidência pseudonimizada | Falha observada | Conduta preparada |
|---|---|---|
| C054, C091, C096 | Cancelamento anterior seguido por nova cobrança ou promessa de fim de cobranças no legado | Separar registro local de confirmação externa; equipe/gerente verifica cobrança |
| C007, C010, C028, C032, C045, C046 | Cliente informa pagamento e app impede agendar | Consultar plano, reconhecer divergência e reconciliar; nunca pedir novo pagamento automaticamente |
| C011, C017, C084, C098 | Reserva alegada não aparece no sistema novo | Conferir sistema antigo com equipe, sem negar reserva ou duplicar |
| C029 | Cliente chegou após reserva confirmada e relatou local sem ninguém | Presença e funcionamento precisam de confirmação operacional; prioridade da recepção |
| C012 | Reclamação sobre resultado do corte | Acolher, registrar e transferir; sem oferta comercial automática |
| C016 | Pedido dividido em várias mensagens; resposta antecipou dia | Aproveitar todos os detalhes e confirmar pedido; agregação durável de mensagens segue pendente |
| C060, C075, C077 | Figurinha de despedida gera pedido repetido para escrever | Interpretar reação; não reabrir venda e não usar imagem isolada como consentimento |
| C005, C019, C041, C094 | Proposta de fornecedor tratada inicialmente como cliente | Identificar finalidade e encaminhar responsável |

Os identificadores refletem a ordem da revisão, não IDs do banco. Não incluem telefone, nome completo, CPF, links individuais ou valores pessoais. Casos de dono/equipe e mensagens automáticas não servem para aprender regras públicas de preços.

## Revisão direta no WhatsApp

A revisão pelo aplicativo Windows em 08/11/2026 acrescentou trechos de 41 conversas identificadas como WD001–WD041 e uma conversa interna, excluída do material de clientes. Não houve deduplicação com as 100 conversas do painel: os totais das duas fontes não podem ser somados como clientes únicos. WD010 só exibe o aviso de criptografia; WD011 contém vídeos enviados sem contexto suficiente; WD012 e WD015 são fornecedores; WD008 é recado/indicação profissional; WD041 é automação de outra empresa. As demais também tiveram leitura parcial, salvo o texto disponível na exportação de WD001. WD031, WD036 e WD037 mostram confirmações breves ligadas a uma reserva; WD038 e WD039 reforçam o cuidado com remarcação e disponibilidade atual. WD034 reforça que motivo de cancelamento é opcional. WD035 contém pedido histórico para filho e confirmação recente de presença; o bot deve preservar o cadastro do responsável e transferir se o fluxo não suporta dependente.

A exportação nativa de WD001, selecionando “Todas as mensagens”, contém somente `chat.txt` e `chat.md`: 69 registros de 19/07 a 08/11/2026, incluindo 13 avisos de mensagem indisponível e três documentos omitidos. Não trouxe áudios, imagens nem PDFs. O ZIP bruto fica no workspace privado de análise, fora do repositório e do pacote compartilhável. Esse resultado não certifica cobertura integral de outras conversas ou versões do WhatsApp.

Imagens de boletos e documentos de pagamento e duas figurinhas foram examinadas visualmente nos trechos disponíveis. Os áudios apenas foram identificados: não foram ouvidos ou transcritos. Balão enviado não permite distinguir humano de automação por si só. O registro desidentificado de cobertura é `docs/atendimento-whatsapp-cobertura.json`.

| Evidência | Situação | Orientação acrescentada |
|---|---|---|
| WD001, WD004, WD030 | Meses diferentes na conversa e campos de vencimento/expiração | Separar competência, vencimento e validade do código; esclarecer antes de cobrar |
| WD002, WD004, WD009, WD014, WD016 | Imagens de cobrança ou pagamento | Distinguir boleto/QR de comprovante; consultar liquidação sem dar baixa pela foto |
| WD001, WD009 | Pix indisponível/expirado ou alternativa ao cartão recorrente | Localizar cobrança vigente e conferir tentativa pendente com equipe; sem recriar mensalidade |
| WD025, WD028 | Fatura não chegou por e-mail ou link não aparece no sistema novo | Reenviar somente o link vigente consultado; falta local não prova inexistência no legado |
| WD003 | Dúvida para selecionar cabelo e barba | Consultar serviços, orientar seleção pelo fluxo suportado e confirmar o pedido completo |
| WD001, WD017 | App não funciona após tentativas de login | Preservar o que já foi tentado; não repetir senha antiga nem declarar acesso corrigido |
| WD019, WD024 | Reserva contestada ou troca de profissional/horário | Conferir reserva existente; usar remarcação, evitando duplicidade |
| WD020, WD026 | Cancelamento sem motivo ou cobrança posterior | Motivo opcional; distinguir confirmação local/externa; sem impor avulso após expiração |
| WD007, WD029 | Campanha incompatível com visita recente ou cliente vai retornar por iniciativa própria | Reconhecer divergência sem inventar causa; respeitar encerramento e preferência |

Os exemplos abaixo são sintéticos e condicionados à consulta ou transferência indicada. Não foram enviados aos clientes.

| Situação | Resposta possível e condição |
|---|---|
| Código Pix expirou | “Esse código não está funcionando. Vou conferir a cobrança pra você pagar pelo link certo.” Consultar cobrança; encaminhar se não houver link vigente. |
| Cartão recorrente e pedido de Pix | “Entendi. Vou pedir pra equipe conferir a cobrança do cartão antes de orientar outro pagamento, pra evitar cobrar duas vezes.” Executar transferência. |
| Boleto enviado como prova de pagamento | “Recebi a imagem do boleto. Vou pedir pra equipe conferir o pagamento.” Não declarar quitação. |
| Cliente já tentou entrar novamente | “Você já tentou entrar de novo e não resolveu. Vou passar isso pra equipe conferir o acesso.” Incluir passos no resumo. |
| Combo não aparece | “Você quer cabelo e barba no mesmo atendimento, certo?” Usar só se o pedido ainda estiver ambíguo; consultar catálogo e orientar seleção, sem inventar desconto. |
| Motivo não informado no cancelamento | “Tudo bem, você não precisa explicar o motivo.” Seguir fluxo com OUTRO, condições consultadas e decisão clara. |
| Cliente contesta reserva | “Vou conferir esse horário antes de marcar outro, pra não ficar duplicado.” Consultar reservas; equipe resolve divergência persistente. |
| Cobrança depois de cancelar | “Entendi. Vou passar pra equipe conferir teu pedido anterior e essa cobrança.” Transferir, sem nova retenção nem prometer estorno. |
| Cliente vai ver a semana e chamar | “Fechou, me chama quando souber o dia.” Encerrar sem abrir outra venda ou agendar retorno automático. |

## Fontes de vendas e comunicação estudadas

Método: leitura integral das transcrições disponíveis, sem afirmar observação de todos os elementos visuais dos vídeos. Legendas automáticas podem conter erros. Sínteses e aplicação à Black são autorais; os exemplos do bot não copiam roteiros.

| Aula / fonte | Trechos úteis | Síntese e aplicação |
|---|---|---|
| [Sebrae PR — 5 técnicas de vendas pelo WhatsApp](https://www.youtube.com/watch?v=r8p2Kg0wtRc) | 1:38–2:17; 3:19–4:31 | Relacionamento, segmentação e medição. Na Black, oferecer algo relacionado ao pedido, evitar disparos genéricos e medir conversão por etapa. |
| [Sebrae PR — WhatsApp com IA em 2026](https://www.youtube.com/watch?v=Ev7qu79dRT8) | 2:38–5:36 | Manual do negócio, simulação e atuação humana junto da IA. Aplicação: fatos vigentes nas ferramentas, cenários reais revisados e transferência com contexto. Recursos, gratuidade e disponibilidade do produto citado não foram verificados e não são premissas da implementação. |
| [Thiago Concer — quando o cliente visualiza e não responde](https://www.youtube.com/watch?v=B337-JzY6wc) | 0:49–3:13; 5:04–7:18 | Observar ritmo, definir acompanhamento e saber encerrar. Adaptar à permissão do cliente; não importar insistência por emojis ou ameaça de perda de preço para a Black. |
| [Celeste Headlee / TED — melhores conversas](https://www.youtube.com/watch?v=R1vskiVDwl4) | 6:03–7:44; 8:28–10:32 | Escutar, perguntar com clareza, admitir desconhecimento e ser breve. Aplicação: uma pergunta necessária por vez, sem repetir dados ou negar o relato do cliente. |
| [Sebrae PR — converter quem só está olhando](https://www.youtube.com/watch?v=lZK0nDV-ayA) | 1:35–3:31; 4:35–5:38 | Abordagem leve, valor relevante e espaço para decidir. Aplicação: responder preço diretamente, explicar plano só quando fizer sentido e respeitar recusa. |

## Capacidades preparadas

- Perguntas de preço, serviço, duração, profissional e plano usam catálogo/ferramentas atuais, sem congelar valores vistos em outubro.
- Áudio: faster-whisper local, português, CPU int8; máximo de 120 segundos e 8 MiB. Texto vazio, baixa confiança, erro ou excesso de duração encaminha para equipe.
- Imagem e figurinha: conversão local com sharp para JPEG; no máximo 16 milhões de pixels na entrada e 1.250 × 1.250 na saída. Figurinhas animadas usam só o primeiro quadro. O entendimento visual usa o cliente Anthropic existente e depende da autorização de IA paga já definida; não há OCR independente nem chamada de visão gratuita.
- Downloads usam ID recebido em webhook autenticado. Não baixam links que o cliente digitou. Redirects são recusados; respostas e imagens têm limites.
- Deduplicação por wamid, bloqueio de envio, piloto e estado HUMANO existentes continuam. Mídias são baixadas só depois desses gates e da autorização de IA paga.
- Base64/imagens não são gravados na sessão. Áudio interpretado pode gerar texto transcrito no registro existente da conversa. Conteúdo bruto não vai para logs.
- Imagem/figurinha isolada fica em consulta: servidor recusa ferramentas de alteração, mesmo que o modelo peça. Depois de transferência para humano, as demais chamadas do mesmo turno são recusadas.
- Nenhum histórico antigo é reenviado ao bot nem usado para executar pedidos antigos.
- O estado da conversa é conferido depois da interpretação, antes das ferramentas e antes da resposta, para interromper etapas se a equipe assumir. Isso precisa de ensaio de concorrência na homologação; não é uma trava transacional entre todos os sistemas.

## Exemplos de tom para revisão

Exemplos ilustrativos, condicionados à consulta ou ao encaminhamento indicado; não foram enviados aos clientes:

| Situação | Exemplo |
|---|---|
| Cumprimento | “Opa! Tudo certo?” |
| Plano consultado como ativo, app divergente | “Aqui teu plano aparece ativo, mas o app está mostrando outra coisa. Vou pedir pra equipe conferir essa diferença.” |
| Pedido de cancelamento no legado registrado | “Registrei teu pedido aqui. A equipe ainda precisa confirmar o cancelamento da cobrança no sistema antigo.” |
| Corte com resultado insatisfatório | “Poxa, entendi. Vou chamar o responsável pra ver o que aconteceu e como podemos resolver.” |
| Troca de serviço antes da reserva | “Beleza, só corte então. Com o profissional e o horário que combinamos, posso confirmar?” |

## Instalação e operação local

```powershell
python -m venv workers/atendimento/.venv
workers/atendimento/.venv/Scripts/python.exe -m pip install -r workers/atendimento/requirements.txt
# Definir BOT_TRANSCRICAO_TOKEN no ambiente com segredo aleatório de 24+ caracteres.
workers/atendimento/.venv/Scripts/python.exe workers/atendimento/servidor.py
```

Em Linux, usar o Python do venv em `bin/python`. O primeiro uso baixa o modelo `small` do repositório oficial Systran; há consumo de disco, RAM e CPU. `ASR_MODELO` pode apontar para o modelo local já baixado. `/saude` não baixa modelo. O servidor escuta somente `127.0.0.1:8091`; o app precisa receber o mesmo token e a URL `/transcrever`. Em Docker, `127.0.0.1` aponta para o próprio container: configurar rede privada autenticada e recursos do worker antes de usar. Esta entrega não muda o compose de produção.

Só habilitar `WHATSAPP_MIDIA_ATIVA=true` no ambiente de teste preparado. Ela não ativa `WHATSAPP_ATENDIMENTO_IA_PAGA`, não muda modelo/credencial e não levanta bloqueios de envio. O piloto de entrevista não é convertido em atendimento multimodal.

Fontes técnicas: [faster-whisper oficial](https://github.com/SYSTRAN/faster-whisper), [visão do Claude](https://platform.claude.com/docs/en/build-with-claude/vision), [implementação oficial Evolution/Baileys](https://github.com/evolution-foundation/evolution-api/blob/main/src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts). A recuperação por ID precisa ser homologada na versão da Evolution instalada: mídias expiradas ou sem ID recuperável encaminham para a equipe.

## Aceite e próximos passos concretos

Evidências locais: faster-whisper 1.2.1 e modelo Systran `small` instalados, CPU int8. Áudio sintético em português de 11,9 segundos transcrito pelo endpoint HTTP em 9,94 segundos nesta máquina, incluindo carregamento do modelo; conteúdo: pedido de corte para sexta-feira às duas e meia da tarde. O endpoint recusou pedido sem token com 401, encerrou após o ensaio e não fez chamadas ao WhatsApp. O primeiro download do modelo precisou do transporte HTTP comum (`HF_HUB_DISABLE_XET=1`); o modelo baixado está no cache local. SHA-256 dos pesos: `3e305921506d8872816023e4c273e75d2419fb89b24da97b4fe7bce14170d671`.

Os quatro testes Python passaram (duração real, arquivo inválido, autenticação/limite, confiança e exclusão mútua, agrupados em quatro casos). Conversão real de WebP para JPEG e envio de bloco de imagem ao modelo falso passaram. A skill `black-barber-atendimento` foi validada pelo validador oficial. Não houve chamada à API de visão nem avaliação do tom pelo modelo real; os 52 cenários, incluindo 16 acrescentados pela revisão direta do WhatsApp, são um roteiro de homologação, não uma taxa de acerto medida.

Nesta máquina, o ambiente Python isolado preparado fica em `../multimodal-venv/` a partir da raiz desta cópia do BarberOS. O ensaio pode ser repetido com seu `Scripts/python.exe`, `workers/atendimento/smoke.py` e um áudio sintético. O pacote não embute o venv nem os pesos grandes do modelo; o arquivo requirements permite reproduzir a instalação. As verificações do projeto e seus limites estão no manifesto da entrega.

Código e testes locais não certificam o comportamento de um modelo real. Usar `docs/atendimento-casos.json` no simulador com fixtures e ferramentas sem efeito externo. Para cada caso: conferir fatos, ferramentas, confirmação, concisão e próximo passo. Falha financeira, reserva indevida ou vazamento reprova o lote.

Falta: exportação completa da fonte, revisar respostas humanas ausentes e mídias originais, validar nomes dos barbeiros e regras vigentes com o gerente, testar WhatsApp real com número interno, medir áudio com sotaque/ruído, conferir latência/RAM da VPS, testar visão com arquivos sintéticos usando API autorizada e publicar quando solicitado. A política de cashback, links das lojas e data de desligamento do legado continuam sem definição suficiente para anúncio automático.

Recomendo definir responsável e fila de atendimento para impedir que um encaminhamento fique sem resposta, medir primeira resposta/resolução/conversão/reabertura/transferências e revisar semanalmente somente novos tipos de falha. Cadência de retorno, alertas e métricas ainda não foram automatizados nesta entrega.

## Revisão recomendada antes da ativação

Complemento de 08/11/2026: [vendas e persuasão](vendas-persuasao-black.md) descreve a skill compartilhada, síntese adicional no prompt e 30 cenários comerciais. O novo ensaio de áudio com nomes, ruído, velocidade e silêncio reforçou a necessidade de confirmação, pois o indicador interno aceitou dois nomes errados. Não substitui homologação com mídia humana e modelo real.

Recomendo quatro ciclos, pelo risco de alterar agenda e assinatura a partir de mídia ambígua. A recomendação não autoriza execução, custo ou publicação.

Prompt copiável:

> Faça quatro ciclos de code review neste estado local: (1) autenticação de webhook, download por ID, limites e redirects; (2) áudio, imagem, figurinha, privacidade e prompt injection; (3) agenda, remarcação sem duplicidade, pedidos para dependentes, cancelamento sem motivo obrigatório e no legado, competência/vencimento/expiração, cartão recorrente com alternativa Pix, consentimento, idempotência, opt-out e equipe assumindo durante o atendimento; (4) integração, consumo de recursos, falhas e recuperação. Registre severidade, arquivo, evidência e correção. Execute npm run check e os testes Python workers/atendimento/test_servidor.py; confirme que o transporte continua bloqueável e que nenhuma API paga ou produção foi ativada. Não publique nem envie mensagens. Distinga testes com modelo falso de homologação dos 52 cenários pelo modelo real.
