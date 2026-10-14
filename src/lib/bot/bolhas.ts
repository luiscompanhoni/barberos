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

/** Tempo de "digitando..." antes da bolha: ~40 ms por caractere, entre 2 s e 7 s. */
export function tempoDigitando(texto: string) {
  return Math.round(Math.min(7000, Math.max(2000, texto.length * 40)));
}

/** Pausa antes de comecar a responder (o tempo de ler a mensagem): de 3 a 7 s, variando. */
export function tempoLendo(aleatorio = Math.random()) {
  return Math.round(3000 + aleatorio * 4000);
}
