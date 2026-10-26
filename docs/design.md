# Design e acessibilidade

## Direção

Identidade visual Black Barber: tema escuro (preto + grafite + dourado), fonte Inter, interface em português
(`<html lang="pt-BR">`). Dois públicos ([PRODUCT.md](../PRODUCT.md)): a equipe no painel (celular e computador) e o
cliente na área `/c` (pensada para celular). Os jogos de recompensa têm um visual próprio, mais teatral, dentro da
mesma paleta.

## Sistema existente

Fonte de verdade: `src/app/globals.css` (Tailwind 4, `@import "tailwindcss"` + `@theme`). Não duplique valores aqui.

- **Paleta "Black" por reapontamento:** as telas usam as classes padrão do Tailwind (`white`, `zinc`, `emerald`,
  `red`, `amber`, `violet`, `sky`) e o `@theme` troca essas cores pelo tema escuro, num lugar só:
  - `white` → superfície dos cartões (grafite); `black` → preto.
  - `zinc` → escala invertida (50 = superfície, 900/950 = texto forte).
  - cores de status (`emerald`, `red`, `amber`, `sky`) → fundos escuros translúcidos + textos claros.
  - `violet` (selo "Assinante") → dourado.
- **Tokens da marca:** `ouro`, `ouro-claro`, `ouro-escuro` e `fundo` (uso direto: `bg-ouro`, `text-ouro`...). Fundo
  da página e `themeColor` do viewport em `#0a0a0a`; seleção de texto dourada; `color-scheme: dark` em campos.
- **Tipografia:** Inter (`--font-inter`, pesos 400–900) e Geist Mono, carregadas por `next/font/google` em
  `src/app/layout.tsx`.
- **Utilitários (`@utility`) reaproveitados:** `btn`, `btn-primario` (dourado, caixa alta), `btn-perigo`, `campo`,
  `campo-linha`, `rotulo`, `cartao`, `cartao-clicavel`, `cartao-destaque`, `selo-ouro`, `entrar-suave`,
  `titulo-marca`, `eyebrow`. Prefira-os a repetir classes.
- **Jogos:** bloco próprio em `globals.css` (fundo com fumaça, carta do prêmio por raridade, roleta) e CSS Modules em
  `src/components/jogos/caixas/caixas.module.css` e `src/components/jogos/raspadinha/raspadinha.module.css`.
- **Ícones:** `lucide-react`.
- **Componentes:** um diretório por domínio em `src/components/<domínio>/` (telas `*Tela.tsx` client-side que falam
  com a API via `src/lib/cliente-api.ts`); comuns na raiz: `Modal`, `Navegacao`, `AbasPainel`, `Marca`,
  `FotoBarbeiro`, `FaixaAmbiente`. Kit compartilhado dos jogos em `src/components/jogos/kit/` (som, partículas,
  modal de resultado, ícones de prêmio, `useJogada`, `useMovimentoReduzido`).

## Interação

Use HTML semântico, navegação por teclado, foco visível e contraste adequado. Dê nome a controles e campos. Erros de
validação ficam junto do campo; operações assíncronas exibem espera e resultado. Respeite movimento reduzido.

O que está implementado:

- **Modal** (`src/components/Modal.tsx`): `role="dialog"`, `aria-modal`, `aria-label` com o título, fecha com Esc,
  clique fora ou botão "Fechar" (com `aria-label`). No celular abre como folha de baixo; em `sm+`, centralizado.
- **Foco:** `campo` usa `focus:border-ouro` + `focus:ring-2`; botões dependem do foco padrão do navegador (há só um
  uso de `focus-visible` no código).
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

## Layout e revisão

- **Painel:** `Navegacao` mostra menu lateral fixo (largura 60) a partir de `lg`; abaixo disso, cabeçalho no topo e
  barra de navegação fixa embaixo com os primeiros itens e um selo quando há pendência nos demais. Barra de abas
  (`AbasPainel`, até 8) lembra a última página e a rolagem.
- **Área do cliente:** coluna única centralizada `max-w-2xl` (`src/app/c/(area)/layout.tsx`), navegação em
  `NavCliente`.
- **Tempo real:** recepção, comandas e conversas atualizam por SSE.
- Revisão em aparelho: a tela inicial com jogada pendente foi testada em iPhone e Android emulados no Chromium;
  teste em aparelho real está pendente ([pendencias.md](pendencias.md)).
- Não documentado: guia de estados vazios/erro/carregamento por tela, auditoria formal de contraste ou de leitor de
  tela. Não há PWA (o app não é instalável).

## Manutenção

Mudanças visuais e de interação atualizam `src/app/globals.css`/componentes e esta orientação quando houver alteração
de regra.
