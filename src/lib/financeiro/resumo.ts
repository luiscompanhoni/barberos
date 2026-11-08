/**
 * Resumo do mes (so o dono): receitas, despesas pagas e o resultado, comparando com o mes anterior.
 * Receita das comandas conta pela data do fechamento; a parte paga antes pelo link fica fora dela porque
 * ja entra em "pagamentos antecipados" (pela data em que o cliente pagou). O mesmo vale para o que foi
 * pago por link de pagamento (entra em "links", pela data do pagamento). Assim nada conta duas vezes.
 * Estorno: o recebimento original fica na data dele e o estorno desconta na data em que foi feito.
 */
import { dataLocal } from "@/lib/agenda/tempo";
import type { Prisma } from "@prisma/client";
import { foiRecebido, resumoComanda } from "@/lib/comandas/regras";
import { estornosEfetivos } from "@/lib/estornos/financeiro";
import { recebimentosMensalidades } from "./recebimentos";
import { somarPorForma } from "@/lib/estornos/regras";
import { db } from "@/lib/db";
import { janelaMes } from "./despesas";
import { mesAnterior, serieDiaria, variacao } from "./regras";

async function numerosMes(mes: string, c: Prisma.TransactionClient = db) {
  const { gte, lt, fuso } = await janelaMes(mes, c);
  const janela = { gte, lt };
  const [comandas, antecipados, cobrancas, links, despesas, estornos] = await Promise.all([
    c.comanda.findMany({ where: { status: "FECHADA", fechadaEm: janela }, include: { itens: true, pagamentos: true } }),
    c.pagamentoAntecipado.findMany({ where: { status: { in: ["PAGO", "CREDITADO", "ESTORNADO"] }, pagoEm: janela }, select: { valorCentavos: true, pagoEm: true } }),
    recebimentosMensalidades(janela, c),
    c.linkPagamento.findMany({ where: { status: { in: ["PAGO", "ESTORNADO"] }, pagoEm: janela }, select: { valorCentavos: true, pagoEm: true } }),
    c.despesa.findMany({ where: { status: "PAGA", pagoEm: janela }, select: { categoria: true, valorCentavos: true, pagoEm: true } }),
    estornosEfetivos(janela, c),
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
  const totalMensalidades = cobrancas.total;
  for (const a of antecipados) receitasDia.push({ data: dataLocal(a.pagoEm!, fuso), valor: a.valorCentavos });
  for (const c of cobrancas.registros) receitasDia.push({ data: dataLocal(c.em, fuso), valor: c.valorCentavos });
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
      mensalidades: { total: totalMensalidades, quantidade: cobrancas.quantidade, porFonte: cobrancas.porFonte, pendentes: cobrancas.pendentes.length, nominalPendente: cobrancas.nominalPendente, completo: cobrancas.completo },
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
export async function resumoMes(mes: string, c: Prisma.TransactionClient = db) {
  const ant = mesAnterior(mes);
  const [atual, anterior] = await Promise.all([numerosMes(mes, c), numerosMes(ant, c)]);
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
