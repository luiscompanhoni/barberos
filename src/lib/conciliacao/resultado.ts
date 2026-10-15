/**
 * Resultado do mes lado a lado: o faturamento registrado no BarberOS, o que caiu na Celcash (mensalidades) e na
 * Stone (maquininha e Pix), as taxas, as saidas (pagamentos por categoria, retiradas do socio, transferencias) e o
 * lucro, com as divergencias marcadas.
 */
import type { Sessao } from "@/lib/auth/sessao";
import { auditar } from "@/lib/auditoria";
import { db } from "@/lib/db";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import { taxas } from "@/lib/financeiro/conciliacao";
import { janelaMes } from "@/lib/financeiro/despesas";
import { resumoMes } from "@/lib/financeiro/resumo";
import { divergente, resumirExtrato, type TipoExterno } from "./regras";
import { salvarRegra } from "./stone";

/** Categorias de saida que NAO sao despesa da operacao (nao entram no lucro). */
export const NAO_DESPESA = ["RETIRADA_SOCIO", "JA_LANCADA"] as const;
const naoDespesa = (c: string | null) => !!c && (NAO_DESPESA as readonly string[]).includes(c);
const reais = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

type Mov = { fonte: string; tipo: TipoExterno; forma: string | null; valorCentavos: number; categoria: string | null };

/** Saidas classificadas de uma fonte: despesa por categoria, retiradas e o que falta classificar. */
function saidas(movs: Mov[]) {
  const pag = movs.filter((m) => m.tipo === "PAGAMENTO");
  const porCategoria: Record<string, number> = {};
  for (const m of pag) if (m.categoria && !naoDespesa(m.categoria)) porCategoria[m.categoria] = (porCategoria[m.categoria] ?? 0) - m.valorCentavos;
  return {
    despesa: Object.values(porCategoria).reduce((t, v) => t + v, 0),
    porCategoria,
    retiradas: -pag.filter((m) => m.categoria === "RETIRADA_SOCIO").reduce((t, m) => t + m.valorCentavos, 0),
    semCategoria: -pag.filter((m) => !m.categoria).reduce((t, m) => t + m.valorCentavos, 0),
  };
}

export async function resultadoDoMes(mes: string) {
  const janela = await janelaMes(mes);
  const [r, movs, ultimos, tx] = await Promise.all([
    resumoMes(mes),
    db.movimentoExterno.findMany({ where: { data: { gte: janela.gte, lt: janela.lt } }, select: { fonte: true, tipo: true, forma: true, valorCentavos: true, categoria: true } }),
    db.movimentoExterno.groupBy({ by: ["fonte"], _max: { data: true } }),
    taxas(),
  ]);
  const celcashMovs = movs.filter((m) => m.fonte === "CELCASH") as Mov[];
  const stoneMovs = movs.filter((m) => m.fonte === "STONE") as Mov[];
  const celcash = { ...resumirExtrato(celcashMovs), ...saidas(celcashMovs) };
  const stone = { ...resumirExtrato(stoneMovs), ...saidas(stoneMovs) };

  // Taxa da maquininha nao vem no extrato (a Stone ja deposita liquido): estimada pelas taxas configuradas.
  const pf = r.receitas.comandas.porForma;
  const taxa = (f: string) => tx.find((t) => t.forma === f)?.taxaBps ?? 0;
  const maquininhaEstimada = Math.round(((pf.DEBITO ?? 0) * taxa("DEBITO") + (pf.CREDITO ?? 0) * taxa("CREDITO") + (pf.PIX ?? 0) * taxa("PIX")) / 10_000);

  const mensalidades = r.receitas.mensalidades.total;
  const cartaoRegistrado = (pf.DEBITO ?? 0) + (pf.CREDITO ?? 0);
  const custoTaxas = celcash.custoGateway + stone.custoGateway + maquininhaEstimada;
  const despesas = r.despesas.total + celcash.despesa + stone.despesa;
  const lucro = r.receitas.total - custoTaxas - despesas;

  const alertas: string[] = [];
  if (celcashMovs.length && divergente(mensalidades, celcash.recebido)) {
    alertas.push(`Mensalidades registradas (${reais(mensalidades)}) diferentes do que caiu na Celcash (${reais(celcash.recebido)}): diferença de ${reais(celcash.recebido - mensalidades)}.`);
  }
  const semCat = celcash.semCategoria + stone.semCategoria;
  if (semCat > 0) alertas.push(`${reais(semCat)} saíram para terceiros sem categoria: classifique para entrar no lucro.`);
  if (!stoneMovs.length) alertas.push("Sem extrato da Stone neste mês: suba o CSV (Stone > Extrato > Baixar extrato > CSV) para fechar maquininha e despesas.");

  const porCategoria: Record<string, number> = { ...r.despesas.porCategoria };
  for (const s of [celcash, stone]) for (const [c, v] of Object.entries(s.porCategoria)) porCategoria[c] = (porCategoria[c] ?? 0) + v;

  return {
    mes,
    sincronizadoAte: Object.fromEntries(ultimos.map((u) => [u.fonte, u._max.data])),
    registrado: {
      total: r.receitas.total, comandas: r.receitas.comandas.total, porForma: pf, mensalidades,
      antecipados: r.receitas.antecipados.total, links: r.receitas.links.total, estornos: r.receitas.estornos.total,
    },
    celcash,
    stone,
    custos: { celcash: celcash.custoGateway, stone: stone.custoGateway, maquininhaEstimada, total: custoTaxas },
    despesas: { barberos: r.despesas.total, celcash: celcash.despesa, stone: stone.despesa, total: despesas, porCategoria },
    retiradas: celcash.retiradas + stone.retiradas,
    lucro,
    divergencias: {
      mensalidades: celcash.recebido - mensalidades,
      // Cartao: o registrado e bruto; na Stone cai liquido e em outro dia (a diferenca mistura taxa e prazo).
      cartao: (stone.recebidoPorForma.CARTAO ?? 0) - cartaoRegistrado,
      pix: (stone.recebidoPorForma.PIX ?? 0) - (pf.PIX ?? 0),
    },
    alertas,
  };
}

/** Movimentos externos do mes (para conferir e classificar). */
export async function movimentosDoMes(mes: string, tipo?: TipoExterno) {
  const janela = await janelaMes(mes);
  return db.movimentoExterno.findMany({
    where: { data: { gte: janela.gte, lt: janela.lt }, ...(tipo ? { tipo } : {}) },
    orderBy: { data: "desc" }, take: 3000,
    select: { id: true, fonte: true, data: true, valorCentavos: true, tipo: true, forma: true, descricao: true, categoria: true, observacao: true, classificadoPorId: true },
  });
}

/** O dono corrige o tipo/categoria de um movimento. `lembrar`: vira regra para esse nome (vale para os proximos). */
export async function classificarMovimento(s: Sessao, id: string, d: { tipo: TipoExterno; categoria: string | null; observacao?: string | null; lembrar?: boolean }) {
  const m = await db.movimentoExterno.findUnique({ where: { id } });
  if (!m) throw naoEncontrado("Movimento");
  if (d.tipo === "PAGAMENTO" && m.valorCentavos > 0) throw new ErroNegocio("Entrada não pode ser pagamento.");
  await db.$transaction(async (tx) => {
    await tx.movimentoExterno.update({ where: { id }, data: { tipo: d.tipo, categoria: d.tipo === "PAGAMENTO" ? d.categoria : null, observacao: d.observacao ?? m.observacao, classificadoPorId: s.usuarioId } });
    await auditar(tx, s.usuarioId, "conciliacao_classificar", "movimento_externo", id, { antes: { tipo: m.tipo, categoria: m.categoria }, depois: { tipo: d.tipo, categoria: d.categoria }, descricao: m.descricao });
  });
  if (d.lembrar && m.observacao) return { aplicadas: await salvarRegra(s, { padrao: m.observacao, tipo: d.tipo, categoria: d.tipo === "PAGAMENTO" ? d.categoria : null }) };
  return { aplicadas: 0 };
}
