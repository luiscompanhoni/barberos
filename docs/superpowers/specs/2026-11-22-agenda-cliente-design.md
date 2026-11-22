# Validação da agenda do cliente

O cliente no iPhone precisa sair de um link direto e chegar à escolha de horário usando a própria conta. A vitrine continua sendo a entrada de quem vem de uma campanha geral. A recepção precisa poder usar a mesma instalação para entrar como equipe e trocar para cliente sem perder o destino.

## Decisão

Manter a correção publicada `919899a` e comprovar o percurso pela interface. Uma revisão só de código não detectaria navegação cliente, sessão reaproveitada ou regressão em viewport móvel. Só alterar código quando o teste revelar uma falha reproduzível.

## Aceite

- `origin/main` integrada e revisão pública identificada pelo endpoint de saúde.
- No navegador em 390×844, sessão anônima preserva `/c/agendar`, conta fictícia entra pelo código local e chega ao resumo de serviço, profissional e horário.
- Sessão de equipe recebe aviso e consegue entrar como cliente no mesmo destino. O link da vitrine abre a entrada ou a área do cliente.
- Produção é consultada sem autenticação, apenas por leitura. Em ambos os ambientes, a interface para antes de confirmar qualquer reserva.
- O passo a passo do iPhone e o alcance da evidência ficam em `RESULTADO-AGENDA.md`, em commit anterior às demais entregas.
