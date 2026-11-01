# Design Black e Black Estúdio — 01/11/2026

Implementação na candidata `/workspace/barberos-deploy-atual`, baseada em
`5e45f3fbe90110680f8a55b917d213f2865a23cd`, preservando a integração do Estúdio e as correções
operacionais que já estavam nesta cópia. Nenhum commit, push ou deploy foi feito nesta entrega.

## Entregue

- Tema preto e grafite com ouro brilhante, degradê metálico, cartões, campos, foco e animações discretas.
- Menu lateral organizado por área; no celular, atalhos e menu Mais com todos os destinos autorizados.
  Caixa, Comandas, Financeiro e Black Estúdio usam ícones distintos, sem emojis duplicados no menu.
- Financeiro com contextos Barbearia e Pessoal. Relatórios, despesas, conciliação e dados pessoais mantêm
  suas permissões e APIs. O endereço antigo do financeiro pessoal redireciona para o contexto correspondente.
- Black Estúdio integrado à navegação e à visão geral, com projetos, clipes e versões aprovadas reais.
  Envio, edição, montagem, download e aprovação usam a implementação existente do módulo.
- Telas abertas preservam o contexto financeiro na URL e convertem o antigo atalho pessoal.
- Campos de despesas com rótulos associados; menu móvel com Escape, foco contido e retorno ao acionador.

## Validação executada

| Verificação | Resultado |
| --- | --- |
| `npm run check` | Lint, regras locais, tipos, 526 testes em 62 arquivos e build aprovados |
| Build após os ajustes finais de acessibilidade | Aprovado; lint dos dois componentes ajustados também aprovado |
| Fluxo real do Estúdio em banco isolado | 26 verificações aprovadas, incluindo renderização e download de MP4 |
| Navegador Chromium, desktop e celular | Painel, Estúdio, recepção e dois contextos financeiros sem transbordamento horizontal |
| Permissões no navegador | Recepção sem resultado reservado; barbeiro encaminhado ao contexto pessoal |
| Navegação final | Telas abertas preservam contexto; menu Mais navega, fecha com Escape e devolve foco |
| axe, WCAG A/AA, nas três telas verificadas | Nenhuma violação detectada em Estúdio, financeiro pessoal e despesas da empresa |
| Movimento reduzido | Transição de 0s e brilho desativado nos controles verificados |

Os testes do Estúdio usaram exclusivamente o banco local `estudio_test`, gateways de teste e vídeos sintéticos.
As imagens da entrega são capturas da aplicação real com dados de teste. A marca nelas mantém o nome configurado
nessa base, “Barbearia Exemplo”. A verificação automática não substitui revisão em aparelho e leitor de tela reais.
O build conserva quatro avisos anteriores de rastreamento de arquivos dinâmicos nos recursos de backup.

## Estado de publicação

Esta alteração está na cópia de trabalho em nuvem. Não foi sincronizada com o Windows nem publicada na VPS.
Os 42 arquivos que já estavam no índice Git foram preservados. As outras cópias não foram modificadas.
Não houve alteração de banco de produção, migração ou ativação de processamento no servidor.

O Estúdio continua condicionado a `ESTUDIO_HABILITADO` e informa a disponibilidade real do processador.
A publicação depende da preparação operacional descrita em [publicacao-sem-terminal.md](publicacao-sem-terminal.md)
e [estudio-black.md](estudio-black.md), incluindo mídia, banco, recuperação e processador de vídeo.
A assinatura tipográfica é provisória: a chama da logo oficial não foi redesenhada nem substituída por uma imitação.

O pacote incremental desta entrega contém somente a mudança de interface e seus testes/documentos.
Ele pressupõe a candidata com a integração do Estúdio já presente; não é um instalador completo do sistema.
O manifesto registra o SHA-256 anterior e posterior de cada arquivo. Diferenças no destino exigem integração
dos trechos pelo agente local, preservando o trabalho do Windows; não se deve substituir a pasta inteira.

## Revisão sugerida

Recomendo três ciclos antes da publicação, porque esta entrega reorganiza a navegação, reúne contextos financeiros
e torna o Estúdio acessível no novo layout. É uma sugestão; essas rodadas não foram executadas nesta entrega.

Prompt para continuidade:

> Faça três ciclos de revisão desta candidata: (1) permissões e isolamento dos contextos financeiros;
> (2) navegação, responsividade, teclado, movimento reduzido e regressões nas áreas compartilhadas;
> (3) integração do Black Estúdio, persistência das mídias, processador e recuperação de publicação.
> Preserve o índice Git e todas as alterações locais. Registre achados com evidência e execute checks pertinentes:
> testes financeiros e de navegação, teste do Estúdio em banco isolado e build se houver mudança de código.
> Não publique nem altere dados de produção durante a revisão.
