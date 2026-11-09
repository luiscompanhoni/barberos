# Atendimento Black Barber — implementação e operação

Atualizado em 08/11/2026. Separar código local, configuração de produção e comportamento observado. A integração não altera os pesos do modelo.

## Decisões de Ygor

- Meta da migração de assinaturas: **20/11/2026**, com extensão para exceções. Não é autorização para cancelar todos os contratos nessa data.
- Piloto de reativação: **20 pessoas no total**, misturando relacionamentos, com **R$ 200 de custo real máximo** em brindes. Não são 20 por segmento.
- Pagar.me para assinaturas/cobranças; Stone para maquininhas. Não confundir troca de agenda com troca de cobrança.
- Preços do cadastro são a fonte atual; planos ilimitados não devem impor intervalo indevido. Ygor confirmou que **os dois Business, R$ 97 e R$ 156, ficam visíveis, com contratação somente pela recepção**.
- Gerente acompanha o piloto, assume exceções e autoriza estornos dentro das permissões do sistema.

## Implementado localmente

| Área | Comportamento | Limite |
|---|---|---|
| Conhecimento | Síntese de vendas e aprendizados dos vídeos no prompt real, com escuta, contexto, concisão e recusa. | Ainda precisa de avaliação do modelo real pelo gerente. |
| Transferência | Ferramenta grava estado HUMANO e nota interna numa transação; encerra o turno sem outra chamada ao modelo. | Resumo depende dos dados disponíveis; envio já aceito pelo provedor não pode ser desfeito. |
| Equipe respondendo | Suprime aviso final de transferência se já existir resposta da equipe desde o início do turno; aviso sem atraso artificial. | Não é prova de ausência de toda corrida entre processos/provedor. |
| Mensalidade solicitada | Consulta a fatura existente e o gateway, verifica titular, valor, vencimento, forma, estado, link e duplicidade, e relê após a consulta. | Não emite nova fatura. Cartão, boleto vencido, histórico importado ou divergência seguem para conferência. |
| Presente | Ferramenta `meus_presentes` consulta convite vigente e os últimos dez prêmios do próprio contato, com validade, reserva e uso. | Não concede, gira, reserva, agenda ou envia mensagem por conta própria. |
| Jogos | Rejeita prêmio ativo com chance zero e oculta itens sem chance, sem estoque ou com cota esgotada. | Jogos antigos podem precisar de ajuste antes de nova edição. Resultado já concedido permanece registrado. |
| Segmentos | Adiciona 181–365 e mais de 365 dias, preservando o grupo antigo de mais de 180 dias. | “Nunca veio” não vira cliente perdido sem histórico. |
| Campanhas | Revalida exclusão, recusa de automações e estado HUMANO antes do despacho; impede convite nessas situações. | Não implementa uma cadência nova de migração de cartão. |
| Formulário de plano | Deixa vazio o intervalo que é nulo; mostra etiquetas e controle de contratação pela recepção, independente da visibilidade. | Campo novo preparado; exige migração e publicação antes de marcar os dois Business. |

O fluxo existente de cobrança automática continua em `src/lib/assinaturas/cobranca-automatica-rotina.ts`, chamado pela rotina de assinaturas. Não foi duplicado. A versão atual consulta faturas e usa reserva idempotente, conferência do gateway e bloqueio de tentativas incertas. O boleto elegível atualmente é avisado no vencimento; antecipação e boleto vencido não foram habilitados por esta entrega.

## Correção observada em produção

No painel `/planos`, foram retirados os intervalos de **15 dias** e a menção “a cada 15 dias” das descrições:

| Plano | Preço mensal observado | Intervalo corrigido |
|---|---:|---|
| Plano de Corte | R$ 118,00 | Sem intervalo mínimo |
| Plano de Barba | R$ 98,00 | Sem intervalo mínimo |
| Plano de Corte e Barba | R$ 178,00 | Sem intervalo mínimo |

Os campos de usos mensais desses serviços já estavam vazios, indicando uso ilimitado. Mantidos preços, serviços, dias permitidos, profissionais, desconto e limite de horários simultâneos. Há dois planos Business: R$ 97,00 sem intervalo exibido; R$ 156,00 ainda com sete dias. Não foi inferido que essa regra de sete dias também estava errada. Ygor confirmou que ambos devem continuar visíveis e ter contratação somente pela recepção. A regra foi implementada localmente; ainda não está aplicada aos dois registros de produção.

O painel ainda mostra **agenda em transição e conferência no Cash Barber**. Até a reconciliação, o bot não deve confirmar automaticamente horários com base apenas na agenda nova.

## Fechamento do manual comercial

Usar catálogo e configuração atuais, com data e responsável. A revisão do gerente deve fechar: quais planos aparecem na vitrine, quais só a equipe vende, intervalos dos Business, política de cancelamento, permissões e condições de estorno, promoções ativas, regras de uso dos brindes e situação do cashback. Cashback de 1% foi discutido, mas ativação e validade de 20 ou 30 dias continuam sem fechamento; não anunciar por suposição.

Para os dois Business, usar `ativo=true`, `visivel=true`, `compravel=true`, **`vendaSomenteEquipe=true`**. O campo novo separa exposição e canal de contratação. O app e a vitrine mostram preço e consulta à recepção, o bot explica o plano e encaminha a contratação. O servidor bloqueia nova adesão, lista de espera e troca autônoma, inclusive com revalidação sob trava. Recepção/gerência continuam contratando pelo fluxo autenticado. `compravel=false` conserva o bloqueio de todas as novas adesões. Mudança de preço do catálogo não altera contratos anteriores.

### Publicação do campo de contratação

1. Aplicar a migração expansiva `20261108193000_plano_venda_equipe`: adiciona booleano com padrão falso; não renomeia, apaga ou altera planos/assinaturas existentes.
2. Publicar todos os processos leitores e escritores novos antes de ativar a restrição em qualquer registro. A versão antiga ignora o campo.
3. Pelo cadastro administrativo, marcar os dois Business identificados por nome e preço conferidos, mantendo visibilidade e novas assinaturas. Verificar vitrine/app/bot e contratação na recepção, sem cobrança real de teste.
4. Para voltar a uma versão antiga com restrição já ativa, bloquear novas adesões desses planos (`compravel=false`) antes do retorno e atender exceções manualmente; a versão antiga não aplica a restrição nova. Não remover a coluna nem apagar dados. Preservar valores anteriores e reativar somente após conferência.

A migração foi preparada e comparada ao esquema anterior sem conexão com banco. Aplicação em PostgreSQL descartável e produção ainda precisam do ambiente correspondente; não foram executadas nesta entrega.

## Ativação e teste acompanhado

1. Conferir o diff preservando as mudanças anteriores e executar os checks registrados no relatório da entrega.
2. Homologar com o gerente: cobrança já paga, boleto solicitado, cartão, contrato legado, falha de gateway, plano oculto, prêmio vencido, áudio ambíguo, imagem sem instrução, pedido de pessoa, humano respondendo durante o turno e cancelamento decidido.
3. Somente depois da publicação autorizada, testar com número interno e limites do piloto. Modelo e credenciais existentes permanecem; não habilitar API paga por efeito colateral.
4. Para avisos de mensalidade, configurar data inicial sem retroagir ao histórico, hosts oficiais conferidos e uma única rotina de cobrança. Os exemplos de ambiente ficam desativados. Verificar consentimento, template/canal e situação do contrato antes de habilitar envios.
5. Em erro de identidade, cobrança duplicada, cancelamento indevido, prêmio inexistente ou mensagem após recusa: interromper o lote, chamar gerente, preservar evidência e corrigir antes de retomar.

## Revisão semanal

Automação do Codex criada: **Revisão semanal do atendimento Black Barber**, segunda-feira às 9h no horário local do aplicativo. ID: `revis-o-semanal-do-atendimento-black-barber`. Ela consulta fontes acessíveis, informa cobertura, registra os três principais problemas e mantém casos sintéticos. Não envia campanhas nem publica código. Sem acesso a conversas novas, deve declarar a limitação. O computador/aplicativo e os acessos necessários precisam estar disponíveis para a execução local.

O gerente acompanha: resoluções corretas, transferências úteis, erros de fatos/ações, tempo até resposta, reservas concluídas, comparecimento, reclamações e opt-outs. A revisão não é aprovação automática de novas condições comerciais.

## Revisão de código sugerida

Recomendo **quatro ciclos**, pois a entrega reúne conversa, cobrança, prêmio e transferência. As rodadas não foram executadas como um processo separado.

Prompt copiável:

> Faça quatro ciclos de code review do estado local: (1) fontes comerciais, naturalidade, consentimento e separação de campanha/migração; (2) titularidade, faturas, gateway, links, duplicidade e atualização concorrente; (3) transferência HUMANO, resumo, fila de mensagens, prêmios reais, estoque e segmentos; (4) integração, publicação reversível, observabilidade e riscos residuais. Registre achados por severidade, arquivo e evidência; confira as correções e preserve as mudanças anteriores. Rode `npm run check` e os testes Python do worker quando a mídia for afetada. Não envie mensagens, altere contratos, ative API paga ou publique sem instrução específica.
