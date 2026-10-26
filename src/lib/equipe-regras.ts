export function ciclosDaCampanha(quantidade: number, receita: number, metaQuantidade: number, metaCentavos: number) {
  return Math.max(0, Math.min(Math.floor(quantidade / metaQuantidade), metaCentavos > 0 ? Math.floor(receita / metaCentavos) : Infinity));
}

/** Competencia "AAAA-MM" em que o bonus entra: a atual, ou a seguinte se a folha atual ja foi fechada. */
export function competenciaDoBonus(atual: string, fechada: boolean) {
  if (!fechada) return atual;
  const [a, m] = atual.split("-").map(Number);
  return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, "0")}`;
}

export function resumoPessoal(itens: { tipo: string; valorCentavos: number; realizado: boolean; categoria: string }[]) {
  let receitas = 0, despesas = 0, previstasReceitas = 0, previstasDespesas = 0;
  const categorias: Record<string, number> = {};
  for (const i of itens) {
    if (!i.realizado) { if (i.tipo === "RECEITA") previstasReceitas += i.valorCentavos; else previstasDespesas += i.valorCentavos; continue; }
    if (i.tipo === "RECEITA") receitas += i.valorCentavos;
    else { despesas += i.valorCentavos; categorias[i.categoria] = (categorias[i.categoria] ?? 0) + i.valorCentavos; }
  }
  return { receitas, despesas, saldo: receitas - despesas, projetado: receitas - despesas + previstasReceitas - previstasDespesas, categorias };
}
