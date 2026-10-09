/**
 * Resumo do mes (so o dono): receitas, despesas pagas e o resultado, comparando com o mes anterior.
 * Receita das comandas conta pela data do fechamento; a parte paga antes pelo link fica fora dela porque
 * ja entra em "pagamentos antecipados" (pela data em que o cliente pagou). O mesmo vale para o que foi
 * pago por link de pagamento (entra em "links", pela data do pagamento). Assim nada conta duas vezes.
 * Estorno: o recebimento original fica na data dele e o estorno desconta na data em que foi feito.
 */
import { dataLocal } from "@/lib/agenda/tempo";
import { foiRecebido, resumoComanda } from "@/lib/comandas/regras";
import { estornosEfetivos, mensalidadesEstornadas } from "@/lib/estornos/financeiro";
import { somarPorForma } from "@/lib/estornos/regras";
import { db } from "@/lib/db";
import { janelaMes } from "./despesas";
import { mesAnterior, serieDiaria, variacao } from "./regras";

async function numerosMes(mes: string) {
  const { gte, lt, fuso } = await janelaMes(mes);
  const janela = { gte, lt };
  const estornadas = await mensalidadesEstornadas();
  const [comandas, antecipados, cobrancas, links, despesas, estornos] = await Promise.all([
    db.comanda.findMany({ where: { status: "FECHADA", fechadaEm: janela }, include: { itens: true, pagamentos: true } }),
    db.pagamentoAntecipado.findMany({ where: { status: { in: ["PAGO", "CREDITADO", "ESTORNADO"] }, pagoEm: janela }, select: { valorCentavos: true, pagoEm: true } }),
    db.cobranca.findMany({ where: { OR: [{ status: "PAGA" }, { status: "ESTORNADA", id: { in: estornadas } }], pagaEm: janela }, select: { valorCentavos: true, pagaEm: true } }),
    db.linkPagamento.findMany({ where: { status: { in: ["PAGO", "ESTORNADO"] }, pagoEm: janela }, select: { valorCentavos: true, pagoEm: true } }),
    db.despesa.findMany({ where: { status: "PAGA", pagoEm: janela }, select: { categoria: true, valorCentavos: true, pagoEm: true } }),
    estornosEfetivos(janela),
  ]);

  const porForma: Record<string, number> = { DINHEIRO: 0, PIX: 0, DEBITO: 0, CREDITO: 0 };
  const receitasDia: { data: string; valor: number }[] = [];
  let totalComandas = 0;
  let pagoAntes = 0;
  let pagoPorLink = 0;
  for (const c of comandas) {
    const pagos = c.pagamentos.filter(foiRecebido);
    const { troco } = resumoComanda(c.itens, c.pagamentos, c.descontoCentavos);
    let valor = -troco;
    porForma.DINHEIRO -= troco;
    for (const p of pagos) {
      if (p.antecipadoId) { pagoAntes += p.valorCentavos; continue; }
      if (p.linkPagamentoId) { pagoPorLink += p.valorCentavos; continue; }
      porForma[p.forma] = (porForma[p.forma] ?? 0) + p.valorCentavos;
      valor += p.valorCentavos;
    }
    totalComandas += valor;
    receitasDia.push({ data: dataLocal(c.fechadaEm!, fuso), valor });
  }
  const totalAntecipados = antecipados.reduce((t, a) => t + a.valorCentavos, 0);
  const totalMensalidades = cobrancas.reduce((t, c) => t + c.valorCentavos, 0);
  for (const a of antecipados) receitasDia.push({ data: dataLocal(a.pagoEm!, fuso), valor: a.valorCentavos });
  for (const c of cobrancas) receitasDia.push({ data: dataLocal(c.pagaEm!, fuso), valor: c.valorCentavos });
  const totalLinks = links.reduce((t, l) => t + l.valorCentavos, 0);
  for (const l of links) receitasDia.push({ data: dataLocal(l.pagoEm!, fuso), valor: l.valorCentavos });

  const totalEstornos = estornos.reduce((t, e) => t + e.valorCentavos, 0);
  for (const e of estornos) receitasDia.push({ data: dataLocal(e.executadoEm!, fuso), valor: -e.valorCentavos });

  const porCategoria: Record<string, number> = {};
  for (const d of despesas) porCategoria[d.categoria] = (porCategoria[d.categoria] ?? 0) + d.valorCentavos;
  const totalDespesas = despesas.reduce((t, d) => t + d.valorCentavos, 0);
  const receitas = totalComandas + totalAntecipados + totalMensalidades + totalLinks - totalEstornos;
  return {
    receitas: {
      comandas: { total: totalComandas, quantidade: comandas.length, porForma, pagoAntes, pagoPorLink },
      mensalidades: { total: totalMensalidades, quantidade: cobrancas.length },
      antecipados: { total: totalAntecipados, quantidade: antecipados.length },
      links: { total: totalLinks, quantidade: links.length },
      estornos: { total: totalEstornos, quantidade: estornos.length, porForma: somarPorForma(estornos) },
      total: receitas,
    },
    despesas: { total: totalDespesas, quantidade: despesas.length, porCategoria },
    resultado: receitas - totalDespesas,
    serie: serieDiaria(mes, receitasDia, despesas.map((d) => ({ data: dataLocal(d.pagoEm!, fuso), valor: d.valorCentavos }))),
  };
}

/** Resumo do mes AAAA-MM com o mes anterior para comparar. */
export async function resumoMes(mes: string) {
  const ant = mesAnterior(mes);
  const [atual, anterior] = await Promise.all([numerosMes(mes), numerosMes(ant)]);
  return {
    mes,
    ...atual,
    anterior: { mes: ant, receitas: anterior.receitas.total, despesas: anterior.despesas.total, resultado: anterior.resultado },
    variacao: {
      receitas: variacao(atual.receitas.total, anterior.receitas.total),
      despesas: variacao(atual.despesas.total, anterior.despesas.total),
      resultado: variacao(atual.resultado, anterior.resultado),
    },
  };
}
