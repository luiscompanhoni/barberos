export type ValorCrm = number | null;
export const valorDisponivel = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** O zero permanece na escala para não exagerar uma variação pequena. */
export function dominioCrm(series: ValorCrm[][]): [number, number] {
  let menor = 0, maior = 0;
  for (const valores of series) for (const valor of valores) if (valorDisponivel(valor)) {
    menor = Math.min(menor, valor); maior = Math.max(maior, valor);
  }
  return menor === maior ? [0, 1] : [menor, maior];
}

/** Uma ausência quebra a curva, sem interpolar ou transformar ausência em zero. */
export function segmentosCrm(valores: ValorCrm[]) {
  const grupos: { indice: number; valor: number }[][] = [];
  let atual: { indice: number; valor: number }[] = [];
  valores.forEach((valor, indice) => {
    if (valorDisponivel(valor)) atual.push({ indice, valor });
    else if (atual.length) { grupos.push(atual); atual = []; }
  });
  if (atual.length) grupos.push(atual);
  return grupos;
}

/** Arcos representam partes positivas de um total; estornos ficam explícitos na legenda. */
export function resumoRoscaCrm(itens: { valor: ValorCrm }[]) {
  const indisponivel = itens.some(i => !valorDisponivel(i.valor));
  const negativo = itens.some(i => valorDisponivel(i.valor) && i.valor < 0);
  const soma = itens.reduce((s, i) => s + (valorDisponivel(i.valor) ? i.valor : 0), 0);
  const total = indisponivel || !Number.isFinite(soma) ? null : soma;
  return { total, negativo, indisponivel: indisponivel || !Number.isFinite(soma), desenhar: !indisponivel && !negativo && Number.isFinite(soma) && soma > 0 };
}

export function parcelasRoscaCrm(itens: { valor: ValorCrm }[], total: number | null, desenhar: boolean) {
  let inicio = 0;
  const parcelas = [];
  for (const item of itens) {
    const tamanho = desenhar && total ? item.valor! / total * 100 : 0;
    parcelas.push({ tamanho, inicio }); inicio += tamanho;
  }
  return parcelas;
}
