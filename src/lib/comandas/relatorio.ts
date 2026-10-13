/**
 * Numeros de vendas e estoque (painel e tela de estoque).
 */
import { configuracao, limitesDoDia } from "@/lib/agenda/carregar";
import { dataLocal, instanteLocal } from "@/lib/agenda/tempo";
import { db } from "@/lib/db";
import { resumoComanda } from "./regras";

/** Comandas fechadas no periodo: quanto entrou por forma e por tipo de item. */
export async function vendasDoPeriodo(de: Date, ate: Date) {
  const cs = await db.comanda.findMany({
    where: { status: "FECHADA", fechadaEm: { gte: de, lt: ate } },
    include: { itens: { include: { produto: { select: { categoria: true } } } }, pagamentos: true },
  });
  const porForma: Record<string, number> = { DINHEIRO: 0, PIX: 0, CREDITO: 0, DEBITO: 0 };
  const porTipo = { servicos: 0, bar: 0, loja: 0, outros: 0 };
  let total = 0;
  for (const c of cs) {
    const r = resumoComanda(c.itens, c.pagamentos, c.descontoCentavos);
    total += r.total;
    for (const p of c.pagamentos) if (p.status === "PAGO") porForma[p.forma] += p.valorCentavos;
    porForma.DINHEIRO -= r.troco;
    for (const i of c.itens) {
      const v = i.quantidade * i.precoUnitCentavos;
      if (i.agendamentoId) porTipo.servicos += v;
      else if (i.produto?.categoria === "BAR") porTipo.bar += v;
      else if (i.produto?.categoria === "LOJA") porTipo.loja += v;
      else porTipo.outros += v;
    }
  }
  return { comandas: cs.length, totalCentavos: total, porForma, porTipo };
}

/** Vendas de hoje + comandas abertas agora (card do painel). */
export async function vendasDeHoje() {
  const cfg = await configuracao();
  const dia = limitesDoDia(dataLocal(Date.now(), cfg.fuso), cfg.fuso);
  const [vendas, abertas] = await Promise.all([
    vendasDoPeriodo(new Date(dia.inicio), new Date(dia.fim)),
    db.comanda.count({ where: { status: "ABERTA" } }),
  ]);
  return { ...vendas, abertas };
}

/** Produtos no minimo ou abaixo (pendencia do painel). */
export async function produtosAcabando() {
  const ps = await db.produto.findMany({
    where: { ativo: true },
    select: { id: true, nome: true, categoria: true, estoque: true, estoqueMinimo: true, unidade: true },
    orderBy: { estoque: "asc" },
  });
  return ps.filter((p) => p.estoque <= p.estoqueMinimo);
}

/** Resumo da tela de estoque: valor parado, o que acabou e os mais vendidos no mes. */
export async function relatorioEstoque() {
  const cfg = await configuracao();
  const hoje = dataLocal(Date.now(), cfg.fuso);
  const inicioMes = new Date(instanteLocal(`${hoje.slice(0, 8)}01`, 0, cfg.fuso));
  const [produtos, vendidos, vendasMes] = await Promise.all([
    db.produto.findMany({ where: { ativo: true }, select: { id: true, nome: true, estoque: true, custoCentavos: true, precoCentavos: true, estoqueMinimo: true } }),
    db.movimentoEstoque.groupBy({ by: ["produtoId"], where: { tipo: "VENDA", criadoEm: { gte: inicioMes } }, _sum: { quantidade: true } }),
    vendasDoPeriodo(inicioMes, new Date()),
  ]);
  const nome = new Map(produtos.map((p) => [p.id, p]));
  return {
    valorEmEstoqueCentavos: produtos.reduce((s, p) => s + Math.max(0, p.estoque) * p.custoCentavos, 0),
    valorDeVendaCentavos: produtos.reduce((s, p) => s + Math.max(0, p.estoque) * p.precoCentavos, 0),
    acabando: produtos.filter((p) => p.estoque <= p.estoqueMinimo).length,
    maisVendidos: vendidos
      .map((v) => ({ produtoId: v.produtoId, nome: nome.get(v.produtoId)?.nome ?? "(desativado)", quantidade: -(v._sum.quantidade ?? 0) }))
      .sort((a, b) => b.quantidade - a.quantidade)
      .slice(0, 8),
    vendasMes,
  };
}
