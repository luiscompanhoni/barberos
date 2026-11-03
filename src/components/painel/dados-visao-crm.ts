export type PicoCrm = { dias: number; linhas: { diaSemana: number; valores: (number | null)[] }[] };
/** Mantém ausência de histórico como lacuna, em vez de transformar em agenda vazia. */
export function ocupacaoPorDia(pico: PicoCrm) {
  return pico.linhas.map(linha => {
    const medidas = linha.valores.filter((v): v is number => v !== null && Number.isFinite(v));
    return medidas.length ? medidas.reduce((s, v) => s + v, 0) / medidas.length * 100 : null;
  });
}
