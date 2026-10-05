/**
 * Indicadores de assinaturas e do bar/loja num periodo.
 */
import { db } from "@/lib/db";
import { churnMensal, ltv } from "./calculos";
import type { Periodo } from "./periodo";

const intervalo = (de: number, ate: number) => ({ gte: new Date(de), lt: new Date(ate) });

export async function indicadoresDeAssinaturas(p: Periodo) {
  const dias = (p.ate - p.de) / 86_400_000;
  const [ativas, atrasadas, novas, canceladas, ativasNoInicio, recebido, usos, porPlanoRaw, planos] = await Promise.all([
    db.assinatura.findMany({ where: { status: { in: ["ATIVA", "ATRASADA"] } }, select: { precoCentavos: true, planoId: true } }),
    db.assinatura.count({ where: { status: "ATRASADA" } }),
    db.assinatura.count({ where: { ativadaEm: intervalo(p.de, p.ate) } }),
    db.assinatura.findMany({ where: { canceladaEm: intervalo(p.de, p.ate), ativadaEm: { not: null } }, select: { motivoCancelamento: true } }),
    db.assinatura.count({ where: { ativadaEm: { lt: new Date(p.de) }, OR: [{ canceladaEm: null }, { canceladaEm: { gte: new Date(p.de) } }] } }),
    db.cobranca.aggregate({ where: { status: "PAGA", pagaEm: intervalo(p.de, p.ate) }, _sum: { valorCentavos: true } }),
    db.agendamento.findMany({ where: { status: "CONCLUIDO", assinaturaId: { not: null }, inicio: intervalo(p.de, p.ate) }, select: { assinaturaId: true, servico: { select: { precoCentavos: true } } } }),
    db.assinatura.groupBy({ by: ["planoId"], where: { status: { in: ["ATIVA", "ATRASADA"] } }, _count: true, _sum: { precoCentavos: true } }),
    db.plano.findMany({ select: { id: true, nome: true } }),
  ]);
  const mrr = ativas.reduce((s, a) => s + a.precoCentavos, 0);
  const churn = churnMensal(canceladas.length, ativasNoInicio, dias);
  const motivos: Record<string, number> = {};
  for (const c of canceladas) {
    const m = (c.motivoCancelamento ?? "Não informado").split(":")[0].trim() || "Não informado";
    motivos[m] = (motivos[m] ?? 0) + 1;
  }
  const assinantesQueUsaram = new Set(usos.map((u) => u.assinaturaId)).size;
  const receitaPeriodo = recebido._sum.valorCentavos ?? 0;
  // Quanto o assinante "economizou": preco de tabela dos servicos usados menos o que pagou.
  const valorDeTabela = usos.reduce((s, u) => s + u.servico.precoCentavos, 0);
  return {
    ativas: ativas.length,
    atrasadas,
    mrrCentavos: mrr,
    ticketMensalCentavos: ativas.length ? Math.round(mrr / ativas.length) : null,
    novas,
    canceladas: canceladas.length,
    churnMensal: churn,
    ltvCentavos: ativas.length ? ltv(mrr / ativas.length, churn) : null,
    motivos: Object.entries(motivos).sort((a, b) => b[1] - a[1]).map(([motivo, qtd]) => ({ motivo, qtd })),
    recebidoCentavos: receitaPeriodo,
    usos: usos.length,
    usoMedioPorAssinante: assinantesQueUsaram ? usos.length / assinantesQueUsaram : null,
    // Valor efetivo de cada corte do plano (receita / usos) comparado ao preco de tabela
    valorPorUsoCentavos: usos.length ? Math.round(receitaPeriodo / usos.length) : null,
    tabelaPorUsoCentavos: usos.length ? Math.round(valorDeTabela / usos.length) : null,
    assinantesSemUso: Math.max(0, ativas.length - assinantesQueUsaram),
    porPlano: porPlanoRaw.map((x) => ({ nome: planos.find((pl) => pl.id === x.planoId)?.nome ?? "?", ativas: x._count, mrrCentavos: x._sum.precoCentavos ?? 0 })).sort((a, b) => b.mrrCentavos - a.mrrCentavos),
  };
}

export async function indicadoresDoBar(p: Periodo, atendimentos: number) {
  const comandas = await db.comanda.findMany({
    where: { status: "FECHADA", fechadaEm: intervalo(p.de, p.ate) },
    select: { id: true, itens: { select: { quantidade: true, precoUnitCentavos: true, produtoId: true, produto: { select: { nome: true, categoria: true, custoCentavos: true } } } } },
  });
  const porProduto = new Map<string, { nome: string; categoria: string; qtd: number; receita: number; custo: number }>();
  let bar = 0, loja = 0, comBar = 0, comLoja = 0;
  for (const c of comandas) {
    let temBar = false, temLoja = false;
    for (const i of c.itens) {
      if (!i.produto || !i.produtoId) continue;
      const v = i.quantidade * i.precoUnitCentavos;
      if (i.produto.categoria === "BAR") { bar += v; temBar = true; } else if (i.produto.categoria === "LOJA") { loja += v; temLoja = true; }
      const x = porProduto.get(i.produtoId) ?? { nome: i.produto.nome, categoria: i.produto.categoria, qtd: 0, receita: 0, custo: 0 };
      x.qtd += i.quantidade; x.receita += v; x.custo += i.quantidade * i.produto.custoCentavos;
      porProduto.set(i.produtoId, x);
    }
    if (temBar) comBar++;
    if (temLoja) comLoja++;
  }
  const produtos = [...porProduto.values()];
  const receita = produtos.reduce((s, x) => s + x.receita, 0);
  const custo = produtos.reduce((s, x) => s + x.custo, 0);
  return {
    comandas: comandas.length,
    barCentavos: bar,
    lojaCentavos: loja,
    ticketBarCentavos: comBar ? Math.round(bar / comBar) : null,
    ticketLojaCentavos: comLoja ? Math.round(loja / comLoja) : null,
    // Quanto o bar rende, em media, por atendimento feito (mede o habito de consumir)
    barPorAtendimentoCentavos: atendimentos ? Math.round(bar / atendimentos) : null,
    comandasComBarPct: comandas.length ? comBar / comandas.length : null,
    margemBrutaPct: receita ? (receita - custo) / receita : null,
    topProdutos: produtos.sort((a, b) => b.receita - a.receita).slice(0, 8).map((x) => ({ ...x, margemPct: x.receita ? (x.receita - x.custo) / x.receita : null })),
  };
}
