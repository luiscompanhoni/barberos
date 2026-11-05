/** Preserva a escolha apenas quando ela pertence ao plano que está na tela. */
export function formaSelecionada(formasPermitidas: readonly string[], escolhida: string) {
  return formasPermitidas.includes(escolhida) ? escolhida : formasPermitidas[0] ?? "";
}
