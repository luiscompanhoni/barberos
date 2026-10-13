/**
 * Resposta do bot em bolhas, como uma pessoa escreve no WhatsApp: cada paragrafo (linha em
 * branco entre eles) vira uma mensagem, no maximo MAX_BOLHAS; o excesso fica junto na ultima.
 * Antes de cada bolha aparece "digitando..." por um tempo proporcional ao tamanho.
 */

export const MAX_BOLHAS = 3;

export function dividirEmBolhas(texto: string, max = MAX_BOLHAS): string[] {
  const partes = texto.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (partes.length <= max) return partes;
  return [...partes.slice(0, max - 1), partes.slice(max - 1).join("\n\n")];
}

/** Tempo de "digitando..." antes da bolha: ~25 ms por caractere, entre 1,2 s e 4 s. */
export function tempoDigitando(texto: string) {
  return Math.round(Math.min(4000, Math.max(1200, texto.length * 25)));
}
