# Publicação local sem a oferta Dezembro Grátis

Preparar a branch `publicacao/sem-oferta-20261123` a partir de `962f8d7`, com Direct via login do Facebook, melhorias do Leonel e agenda. A promoção aguarda integração com Pagar.me e revisão jurídica. A branch de crescimento preserva sua revisão atual.

## Abordagens

- Adotar uma flag de servidor sobre a trava de homologação. A escolha preserva as correções que compartilham commits com a oferta e permite retomar os ensaios com uma configuração reversível.
- Reverter commits da oferta. As mudanças se cruzam com Direct, agenda, LGPD e isolamento financeiro. A remoção aumentaria o diff e o risco de perder correções, além de alterar o histórico das migrações.

## Comportamento

`OFERTA_DEZEMBRO_ATIVA` ausente, falsa ou inválida fecha a oferta. Somente `true` em `AMBIENTE=homologacao` permite suas telas e rotinas. Adesão continua exigindo modo de homologação, configuração válida e período vigente. A desativação oculta também o cartão de contratos simulados preexistentes, evita o redirecionamento de cancelamento para uma página indisponível e mantém o isolamento desses contratos dos fluxos comuns e das apurações. As URLs exclusivas retornam 404 antes de autenticação e validação do corpo. A configuração de WhatsApp, o bloqueio padrão do Direct e a ativação de IA paga permanecem sob as regras existentes.

As migrações herdadas serão revisadas e ensaiadas em PostgreSQL local. Validar o comportamento da oferta nos dois estados no Chromium com a skill Vercel agent-browser. Rodar os checks e registrar evidências e riscos no relatório solicitado. A entrega termina em commits locais da branch nova. Push, deploy, VPS, mensagens externas e IA paga ficam fora do escopo.
