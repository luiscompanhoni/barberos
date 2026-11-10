# Design e acessibilidade

Preparado em 09/11: seleção de serviços por cartão com `aria-pressed`, agenda direta e abas locais,
indicadores dentro do Financeiro, contato/pesquisa em Conversas e quatro opções de aparência da gestão.
Automático usa faixas fixas em São Paulo; cliente e barbeiro mantêm a identidade Black.
Prévia da roleta no topo e botão central sem translação duplicada.
[Escopo e condições](ajustes-anotacoes-2026-11-09.md).
Revisão: confirmação preserva a seleção durante o salvamento; títulos de etapa recebem foco e
carregamento de horário/preço é anunciado. [Quatro ciclos e evidências](revisao-anotacoes-4-ciclos-2026-11-09.md).

Logo BarberOS aprovada em 03/11/2026: opção 01, chama verde-lima `#C6F566` sobre grafite
`#101316`. Arquivos vetoriais em `public/brand/`; o nome BarberOS está convertido em contornos.
`Marca` apresenta a identidade do sistema e mantém o nome configurado da barbearia como identificação
secundária. O ícone compacto, favicon e os ícones instaláveis usam a mesma chama. Os arquivos em
`public/pwa/` mantêm seus endereços para compatibilidade com notificações e instalações existentes.

## Direção

**Black — Ouro sereno, opção 01 aprovada em 03/11/2026.** Cliente e barbeiro/líder usam
`.black-sereno`: preto quente, superfícies discretas e ouro `#F9CB30`. A abertura do cliente
e das páginas iniciais do barbeiro usa a fachada real tratada em WebP (157 KB), com luz
ambiental e oito partículas CSS; movimento reduzido desliga a animação. Não altera dados
nem remonta formulários. A gestão mantém o visual CRM e a marca BarberOS.
`Marca` usa `public/brand/black/logo-horizontal.svg`, reconstruída em contornos a partir da
referência enviada; proporções e encaixe não recortam a arte. O selo vetorial origina os
ícones Black. `logo-original.png` fica como referência, sem uso na marca da interface.

**Atualização visual CRM de 02/11/2026.** A área autenticada da equipe recebe vidro escuro,
fundo difuso azul/coral/oliva, destaque verde-lima, menu compacto expansível e abas com seleção
animada. A revisão completa alcança as 65 páginas: `.crm-workspace` na equipe e `.crm-surface`
nos fluxos do cliente e nas páginas públicas. A referência
observada foi o vídeo “Sales CRM dashboard” de `_code_and_chill_`, publicação `DfIKeN-P4ox` no Instagram:
somente Overview, Pipeline, Customers e Growth aparecem; as outras páginas não foram demonstradas.
Foram adaptados o tratamento visual e o movimento aos módulos reais, sem dados ou marcas do exemplo.

O painel usa o histórico de ocupação já autorizado e os itens de comandas fechadas. Financeiro e
Indicadores usam as séries existentes em linha/área, rosca e barras; lacunas permanecem indisponíveis,
sem valores inventados. O funil de campanhas mantém suas etapas reais. Movimento reduzido desliga
animações, gráficos mantêm leitura textual e os controles aceitam teclado. A navegação agrupada,
TopoWorkspace, Central de Agentes e contexto financeiro pessoal permanecem disponíveis.

A camada `crm-components.css` harmoniza cabeçalhos, listas, tabelas, filtros e diálogos. Subabas
acompanham o elemento ativo real com uma cápsula, inclusive após rolagem e redimensionamento.
`TransicaoCrm` observa blocos novos durante a vida da página, sem remontar formulários, SSE ou
conteúdo ao trocar filtros. A entrada é curta e escalonada; movimento reduzido a desliga.

Indicadores, detalhe do profissional, financeiro pessoal/empresa, RH, desempenho, avaliações,
recompra, campanhas, estoque e reuniões reutilizam dados já autorizados nos gráficos. Barras
têm eixo zero e leitura textual para negativos e ausências; notas e taxas mantêm suas unidades.
Os números finais ficam disponíveis para leitores de tela durante o contador visual.

Agenda mantém dimensões, arrasto, edição de horários e alternativa por formulário. Busca e filtros
se adaptam ao celular. Cliente, vitrine, login, links de pagamento, privacidade, vagas e checklist
recebem a mesma família de superfícies e controles. QR, pagamentos, termos, permissões e mecânicas
dos jogos não foram alterados. Artes de prêmios e cores de raridade conservam seu significado.

**Base anterior — Black Barber Design System, direção 01 de 01/11/2026.** Preto profundo, superfícies grafite,
ouro luminoso, cartões de 18 px e Manrope. A proposta visual está em
`/workspace/exports/black-barber-design-v1/DESIGN-SYSTEM.md` no ambiente de preparação; o código do aplicativo
é a fonte de verdade dos tokens implementados. Os tokens dourados dessa base são substituídos pelo verde-lima
nas superfícies CRM; cores de status mantêm seus significados. Ações principais têm texto escuro. Movimento reduzido desliga
as transições da área da equipe. O acabamento com tesoura que seguia a rolagem foi retirado do layout.

O menu agrupa Agenda, Relacionamento, Equipe e Configurações, preservando todos os links autorizados pelo
servidor. Caixa e Comandas têm ícones distintos; **Black Estúdio** aparece quando o módulo está habilitado.
Financeiro reúne os contextos **Barbearia** e **Pessoal**; o endereço antigo `/meu-financeiro` encaminha para
`/financeiro?area=pessoal`. Nenhum dado pessoal foi incorporado ao caixa da empresa.

O protótipo foi traduzido para componentes e dados reais: não há indicadores ou formulários simulados nas telas
implementadas. A assinatura tipográfica de `Marca` continua provisória; a chama da logo oficial não foi redesenhada.
A área do cliente e os jogos preservam seus fluxos; a paleta e os controles compartilhados recebem os novos tokens.

## Sistema existente

Fonte de verdade: `src/app/globals.css` (Tailwind 4, `@import "tailwindcss"` + `@theme`). Não duplique valores aqui.

- **Paleta "Black" por reapontamento:** as telas usam as classes padrão do Tailwind (`white`, `zinc`, `emerald`,
  `red`, `amber`, `violet`, `sky`) e o `@theme` troca essas cores pelo tema escuro, num lugar só:
  - `white` → superfície dos cartões (`#111315`); `black` → preto. Para branco de verdade com transparência use
    `rgba(255,255,255,…)` (ex.: `border-[rgba(255,255,255,0.08)]`), não `white/…`.
  - `zinc` → escala invertida (50 = superfície, 900/950 = texto forte).
  - cores de status (`emerald`, `red`, `amber`, `sky`) → fundos escuros translúcidos + textos claros.
  - `violet` (selo "Assinante") → dourado.
- **Tokens da marca:** `ouro`, `ouro-claro`, `ouro-escuro` e `fundo` (uso direto: `bg-ouro`, `text-ouro`...). Fundo
  das superfícies CRM e `themeColor` do viewport em `#101316`; tokens do design system em `:root` (`--surface-*`, `--border-*`,
  `--text-*`, `--glow-ouro`, `--brand-metal`); seleção de texto dourada; `color-scheme: dark` em campos.
- **Tipografia:** Manrope (`--font-manrope`, pesos 300–800; números em peso 400 com `-0.02em`) e Geist Mono, carregadas por `next/font/google` em
  `src/app/layout.tsx`.
- **Utilitários (`@utility`) reaproveitados:** `btn` (bloco escuro de 44px, raio 10px), `btn-primario` (dourado), `btn-perigo`, `campo`,
  `campo-linha`, `rotulo`, `cartao`, `cartao-clicavel`, `cartao-destaque`, `selo-ouro`, `entrar-suave`,
  `titulo-marca`, `eyebrow`, `numero-kpi`. Prefira-os a repetir classes. Área da equipe: `black-workspace.css`
  (menu em painéis `black-painel`/`black-nav-item`, KPI `black-metric` com `--destaque` dourado ou `--ruim`).
- **Jogos:** bloco próprio em `globals.css` (fundo com fumaça, carta do prêmio por raridade, roleta) e CSS Modules em
  `src/components/jogos/caixas/caixas.module.css` e `src/components/jogos/raspadinha/raspadinha.module.css`.
- **Ícones:** `lucide-react`; mapeamento único em `components/navegacao/icones.ts`. Caixa usa HandCoins; Comandas, ReceiptText; Financeiro, Landmark; Black Estúdio, Clapperboard.
- **Componentes:** um diretório por domínio em `src/components/<domínio>/` (telas `*Tela.tsx` client-side que falam
  com a API via `src/lib/cliente-api.ts`); comuns na raiz: `Modal`, `Navegacao`, `AbasPainel`, `Marca`,
  `FotoBarbeiro`, `FaixaAmbiente`. Kit compartilhado dos jogos em `src/components/jogos/kit/` (som, partículas,
  modal de resultado, ícones de prêmio, `useJogada`, `useMovimentoReduzido`).

### Navegação e Financeiro

- Estrutura em `components/navegacao/estrutura.ts`, sempre filtrada pelos links recebidos do layout. Destinos
  desconhecidos entram em Outras áreas; não desaparecem. Grupos não concedem permissões novas.
- No celular, atalhos para início, agenda, comandas e financeiro, conforme disponibilidade; os demais destinos
  ficam no menu Mais, agrupados e identificados. O desktop usa seções expansíveis.
- A página do contexto pessoal não consulta pendências, relatórios ou valores da empresa. Barbeiro e líder são
  encaminhados ao contexto pessoal antes dessas consultas. O layout mantém os selos de navegação autorizados;
  as APIs e suas verificações continuam intactas.
- Abas financeiras usam a URL, com `area` e `aba`; links antigos `?aba=...` continuam válidos. Resumo do mês,
  resultado, despesas, links, estornos e conciliação foram preservados. A aba Caixa continua encaminhando para
  o caixa operacional único.
- As abas de telas abertas guardam também a query e convertem favoritos locais do antigo financeiro pessoal
  para o novo endereço, sem manter dois destinos repetidos.
- Estilos de base estão em `black-navigation.css` e `black-workspace.css`; a apresentação atual é definida por
  `crm-workspace.css`, `crm-components.css` e `crm-public.css`. O
  reapontamento existente de `white`/`zinc` foi preservado por compatibilidade; não foi adicionado outro tema global.

## Interação

Use HTML semântico, navegação por teclado, foco visível e contraste adequado. Dê nome a controles e campos. Erros de
validação ficam junto do campo; operações assíncronas exibem espera e resultado. Respeite movimento reduzido.

O que está implementado:

- **Modal** (`src/components/Modal.tsx`): `role="dialog"`, `aria-modal`, `aria-label` com o título, fecha com Esc,
  clique fora ou botão "Fechar" (com `aria-label`). No celular abre como folha de baixo; em `sm+`, centralizado.
- **Foco:** na equipe, links, botões, resumos expansíveis e campos têm contorno verde-lima de 2 px com afastamento de 4 px. Há atalho para pular ao conteúdo. O menu Mais usa `dialog` nativo, com Escape, foco contido e retorno ao acionador.
- **Movimento reduzido:**
  - Global: `@media (prefers-reduced-motion: reduce)` em `globals.css` encurta toda animação e transição.
  - Jogos: `useMovimentoReduzido()` (`useSyncExternalStore` sobre `matchMedia`) deixa animações curtas, sem tremor
    nem chuva de partículas; usado em Roleta, Caixas, Raspadinha e Partículas. Para teste/demonstração,
    `localStorage["bb-movimento"] = "total"` ignora a preferência do aparelho.
- **Som** (`src/components/jogos/kit/som.ts`): sintetizado na hora com Web Audio (nenhum arquivo de áudio). Só liga
  depois do primeiro toque (`som.destravar()`, regra de iPhone/Android); efeitos curtos e contínuos controláveis
  (suspense, vento, raspagem). Mudo global guardado no aparelho (`localStorage["bb-jogos-mudo"]`), também desliga a
  vibração (`navigator.vibrate`). `BotaoSom` tem `aria-label` e `aria-pressed`.
- **Erros da API** chegam como `{ erro, codigo }` com mensagem pronta em português (ver `src/lib/erros.ts`).
- **Ambiente:** `FaixaAmbiente` mostra uma faixa amarela fixa "HOMOLOGAÇÃO" quando `AMBIENTE=homologacao`.

### Reuniões e evolução da equipe

- **Agenda:** arrastar um intervalo vazio mostra a prévia dourada com início, fim e duração. Soltar abre o modal
  com as opções de agendar ou bloquear; gravar exige confirmação. O botão **+ Atendimento** oferece os campos
  equivalentes para teclado e celular. O modo de arrasto no celular é explícito, para preservar a rolagem normal.
  **Mostrar encaixes** destaca as janelas do serviço escolhido e informa a capacidade, sem somar alternativas
  que ocupam o mesmo intervalo. O ajuste da duração fica no detalhe da reserva.
- **Reuniões:** a apresentação ocupa a tela, aceita teclado e pode ser impressa como slides. A opção para a equipe
  recebe do servidor uma versão sem dados reservados. O editor mantém conteúdo e ações separados dos números
  preservados na geração. Valores ausentes aparecem como pendentes, nunca como zero presumido.
- **Avaliações:** estrelas são opções de um grupo de rádio com nomes acessíveis; cor e texto indicam a nota.
  O convite explica quem pode consultar a identidade. Médias públicas usam lotes de cinco clientes e mostram
  estado de formação quando a amostra é insuficiente. A recompensa é igual para qualquer nota válida.
- **Níveis:** ELITE usa escudo preto/dourado, PLATINA usa metal/prata e LEGEND usa coroa com aura e brilho suave.
  A conquista tem destaque próprio; `prefers-reduced-motion` desativa esses efeitos. A nota dos clientes fica
  separada do nível acumulado.
- Guia de ativação e configuração: [evolucao-equipe.md](evolucao-equipe.md).

## Layout e revisão

- **Painel:** `Navegacao` mostra menu lateral fixo compacto de 84 px, expansível para 246 px, a partir de `lg`; abaixo disso, cabeçalho no topo e
  barra de navegação fixa embaixo com os primeiros itens e um selo quando há pendência nos demais. Barra de abas
  (`AbasPainel`, até 8) lembra a última página e a rolagem.
- **Área do cliente:** coluna única centralizada `max-w-2xl` (`src/app/c/(area)/layout.tsx`), navegação em
  `NavCliente`.
- **Seleção dos serviços:** no agendamento, `aria-pressed` controla o contorno dourado, o fundo destacado e o símbolo de confirmação. A regra fica no tema Black, após a superfície dos cartões, para que o destaque não seja sobrescrito; o segundo toque desmarca o serviço. O espaço do símbolo permanece reservado para evitar mudança de altura com nomes longos. O resumo é uma região de status persistente, com atualização educada e atômica, inclusive quando não há serviços selecionados.
- **Aviso de vaga:** sem horários para o conjunto escolhido, o botão “Me avise se abrir horário” abre a preferência por manhã, tarde, noite ou qualquer horário. Os limites são 12h e 18h, no fuso da barbearia. O pedido salvo fica identificado e pode ser cancelado; não reserva atendimento nem promete envio enquanto o transporte estiver bloqueado.
- **Etiquetas dos serviços:** cada linha em Equipe tem o botão “Etiquetas”. Dono e gerente podem criar, editar e remover até seis etiquetas de 40 caracteres, escolher cor hexadecimal e formato cápsula, arredondado ou retangular, com prévia. A mesma etiqueta aparece no catálogo do cliente; texto preto ou branco é calculado pelo contraste. A etiqueta não substitui a marca de seleção dourada. Conflito de edição exige recarregar explicitamente, preservando a escolha de outro editor.
- **Tempo real:** recepção, comandas e conversas atualizam por SSE.
- Revisão em aparelho: a tela inicial com jogada pendente foi testada em iPhone e Android emulados no Chromium;
  teste em aparelho real está pendente ([pendencias.md](pendencias.md)).
- **Aplicativo instalável:** cliente e equipe têm manifestos próprios e ícones Black Barber. A central apresenta instalação, avisos, aparelhos e preferências; o sino do cabeçalho indica os não lidos. Instalação e permissão de notificações dependem de gesto explícito. No iPhone, orienta Safari e Tela de Início; bloqueio, falta de suporte, simulação e indisponibilidade têm mensagens próprias.
- **Offline:** página pública curta, sem dados da conta, com tentativa de reconexão. O service worker não armazena telas privadas nem respostas de API. Guia: [app-notificacoes.md](app-notificacoes.md).
- Não documentado: guia de estados vazios/erro/carregamento por tela, auditoria formal de contraste ou de leitor de tela.

## Central de agentes

`/agentes` usa os componentes visuais existentes, com fluxo de seis etapas, fila de trabalhos, catálogo de 22 perfis,
rotinas e situação das conexões. Aprovação exige revisão explícita do resultado; integrações pendentes aparecem como pendentes.
Pausa e cancelamento permanecem acessíveis durante o processamento. A lista atualiza apenas com a aba visível e protege respostas fora de ordem.
Trabalhos em aberto aparecem antes do histórico recente, limitado ao total de 100 registros. A confirmação de cancelamento explica
que tarefas derivadas já criadas precisam de cancelamento separado. Respostas 401/403 limpam o conteúdo privado e invalidam leituras anteriores.

## Manutenção

### Identidade dos aplicativos Black

Os aplicativos do cliente e do barbeiro são da **Black Barber**. Usam preto, branco e dourado, as superfícies e a navegação anteriores ao CRM, e a logo original enviada pelo proprietário em 03/11/2026: círculo dourado e palavra BLACK com símbolo branco. A arte fica em `public/brand/black/logo-original.png`, extraída sem redesenho da imagem fornecida. Os ícones de instalação são reduções dessa mesma arte. Não substituir pela chama verde, wordmark ou monograma do BarberOS.

`Marca` apresenta Black por padrão nos fluxos públicos e de cliente; `Navegacao` escolhe BarberOS explicitamente para gestão. Perfis BARBEIRO/LIDER usam `black-app`; DONO/GERENTE/RECEPCAO mantêm `crm-workspace`. A separação é somente visual e não muda os links autorizados, permissões, sessão, agenda, valores ou envio de códigos. O título, os ícones e o manifesto seguem a identidade do público, inclusive no login. Melhorias de acessibilidade permanecem. O painel de gestão mantém o visual e os arquivos de marca BarberOS.

Mudanças visuais e de interação atualizam `src/app/globals.css`/componentes e esta orientação quando houver alteração
de regra.

## Templates do Black Estúdio

Seleção visual entre Recrutamento, Serviços e Equipe, com título e chamada final editáveis. O roteiro aprovado aparece como referência, separado da prévia de vídeo. Estados de render são reais e o download final aparece após a aprovação humana. A troca de template exige salvar e gerar nova versão.
