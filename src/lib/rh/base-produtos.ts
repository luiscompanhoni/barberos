import { resumoComanda, type ItemRegra, type PagamentoRegra } from "@/lib/comandas/regras";

type Item = ItemRegra & { id: string };
/** Rateio exato do recebido: inclui todos os itens, preserva centavos e desconta o troco já devolvido. */
export function basesRecebidasComanda(c: { itens: Item[]; pagamentos: PagamentoRegra[]; descontoCentavos: number }) {
  const r = resumoComanda(c.itens, c.pagamentos, c.descontoCentavos);
  const base = Math.max(0, Math.min(r.total, r.pago - r.troco));
  if (!r.subtotal) return new Map(c.itens.map(i => [i.id, 0]));
  const linhas = c.itens.map(i => {
    const numerador = BigInt(base) * BigInt(i.quantidade * i.precoUnitCentavos);
    return { id: i.id, valor: Number(numerador / BigInt(r.subtotal)), resto: numerador % BigInt(r.subtotal) };
  });
  let sobra = base - linhas.reduce((s, i) => s + i.valor, 0);
  linhas.sort((a, b) => a.resto === b.resto ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.resto > b.resto ? -1 : 1);
  for (const l of linhas) { if (!sobra) break; l.valor++; sobra--; }
  return new Map(linhas.map(i => [i.id, i.valor]));
}

/** Regra autorizada pelo dono em 8/11, vigente em novembro/2026. Fechados usam o retrato histórico. */
export function baseProdutoRecebido(i: Item & { comanda: { fechadaEm: Date | null; itens: Item[]; pagamentos: PagamentoRegra[]; descontoCentavos: number } }) {
  if (i.comanda.fechadaEm && +i.comanda.fechadaEm < +new Date("2026-11-01T00:00:00-03:00")) return i.quantidade * i.precoUnitCentavos;
  return basesRecebidasComanda(i.comanda).get(i.id) ?? 0;
}
