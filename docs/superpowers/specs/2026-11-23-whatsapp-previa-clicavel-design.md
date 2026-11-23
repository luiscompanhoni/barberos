# Preservação da prévia clicável do WhatsApp

A próxima publicação precisa manter a experiência do WhatsApp já entregue pelo app `e434997` e pela Evolution adaptada. O convite de roleta chega com um cartão que abre o link. Quando a miniatura HD falha, a Evolution ainda tenta montar a prévia compacta.

A fonte recuperada e o compilado em execução confirmam que o último balão de uma jornada com roleta é um texto com `linkPreview: true`. O compilado usa o fluxo anterior de teste frio restrito ao telefone do dono, com token `rott_`, campanha de teste pausada e ajuda após leitura. A rota de gestão chama o convite normal. A arte publicada e a orientação para o Leonel encaminhar pedidos pendentes também vieram da etapa anterior e aparecem na imagem ativa.

## Abordagens

- Recuperar o pacote inteiro sobre a branch é rápido e sobrescreve o isolamento do Direct e as autorizações novas de campanha.
- Mover o pedido de prévia para todo texto com link reduziria a passagem de opções e ampliaria o comportamento para outros envios.
- **Decisão aprovada:** integrar as mudanças por comportamento, com opção explícita no último balão, teste frio interno com os controles existentes e preservação da imagem local instalada pelo publicador.

## Aceite

- Convites de roleta pedem prévia no último balão via Evolution, preservam o identificador de entrega e reutilizam a arte da imagem publicada. Os outros convites e a Cloud mantêm seus contratos.
- O teste frio pode ser preparado internamente apenas para o dono ativo no próprio telefone. A campanha pausada dedicada é reconhecida somente para o token de teste e o lote individual. Fora do horário comercial, a única exceção é a primeira ajuda do teste após leitura. A validade da roleta, as preferências, o isolamento do Direct, as travas de transporte e a de IA continuam valendo. A rota atual não ganha um seletor de teste.
- A publicação existente retoma o mesmo container da Evolution e grava a imagem local verificada no Compose da release para futuras operações. O patch de miniatura fica disponível em um Dockerfile de reconstrução.
- A VPS serve somente como fonte de evidência: leitura, inspeção e cópia. As verificações rodam localmente com dados sintéticos, sem envio, cobrança ou IA paga. O commit é local.
