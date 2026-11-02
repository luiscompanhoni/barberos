/** Apenas preparação interna; conteúdo nunca segue automaticamente para tráfego. */
export function destinoAutomatico(agenteId: string, profundidade: number): string | null {
  if (profundidade >= 2) return null;
  if (agenteId === "dados") return "estrategia";
  if (agenteId === "estrategia") return "conteudo";
  return null;
}
