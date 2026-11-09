/**
 * Cada parágrafo vira uma mensagem, no máximo MAX_BOLHAS; o excesso fica na última.
 * O ritmo é proporcional ao texto, sem alterar a identificação do assistente.
 */

export const MAX_BOLHAS = 3;

export function dividirEmBolhas(texto: string, max = MAX_BOLHAS): string[] {
  const partes = texto.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (partes.length <= max) return partes;
  return [...partes.slice(0, max - 1), partes.slice(max - 1).join("\n\n")];
}

/** Pausa por bolha: 750 ms por palavra, entre 2 s e 25 s (30 palavras = 22,5 s). */
export function tempoDigitando(texto: string) {
  const palavras = texto.trim().match(/\S+/gu)?.length ?? 0;
  return Math.min(25_000, Math.max(2_000, palavras * 750));
}

/** Pausa antes de comecar a responder (o tempo de ler a mensagem): de 3 a 7 s, variando. */
export function tempoLendo(aleatorio = Math.random()) {
  return Math.round(3000 + aleatorio * 4000);
}
