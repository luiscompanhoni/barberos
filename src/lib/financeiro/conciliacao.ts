/**
 * Conciliacao: por dia e meio de recebimento, o que o sistema registrou (bruto), a taxa, o liquido
 * esperado e a data prevista do deposito, contra o valor que de fato caiu na conta (informado na conferencia).
 * Dinheiro nao entra aqui: e conferido no fechamento do caixa.
 */
import { configuracao } from "@/lib/agenda/carregar";
import { dataLocal, instanteLocal, somarDias } from "@/lib/agenda/tempo";
import { auditar } from "@/lib/auditoria";
import type { Sessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { ErroNegocio } from "@/lib/erros";
import { estornosEfetivos, mensalidadesEstornadas, PAGAMENTO_RECEBIDO } from "@/lib/estornos/financeiro";
import { dataPrevista, FORMAS_CONCILIACAO, situacaoConciliacao, taxaSobre, type FormaConciliacao } from "./regras";

const PADRAO: Record<FormaConciliacao, { taxaBps: number; prazoDias: number }> = {
  PIX: { taxaBps: 0, prazoDias: 0 },
  DEBITO: { taxaBps: 199, prazoDias: 1 },
  CREDITO: { taxaBps: 349, prazoDias: 30 },
  ONLINE: { taxaBps: 99, prazoDias: 1 },
};

export async function taxas() {
  const atuais = await db.taxaRecebimento.findMany();
  const faltam = FORMAS_CONCILIACAO.filter((f) => !atuais.some((t) => t.forma === f));
  if (faltam.length) await db.taxaRecebimento.createMany({ data: faltam.map((forma) => ({ forma, ...PADRAO[forma] })), skipDuplicates: true });
  const todas = faltam.length ? await db.taxaRecebimento.findMany() : atuais;
  return FORMAS_CONCILIACAO.map((f) => todas.find((t) => t.forma === f)!);
}

export async function salvarTaxas(s: Sessao, lista: { forma: FormaConciliacao; taxaBps: number; prazoDias: number }[]) {
  await db.$transaction(async (tx) => {
    for (const t of lista) await tx.taxaRecebimento.upsert({ where: { forma: t.forma }, create: t, update: t });
    await auditar(tx, s.usuarioId, "taxas_recebimento", "configuracao", "financeiro", { lista });
  });
  return taxas();
}

/** Linhas da conciliacao entre duas datas (AAAA-MM-DD, inclusive). */
export async function conciliacao(de: string, ate: string) {
  if (ate < de) throw new ErroNegocio("A data final é antes da inicial.");
  const cfg = await configuracao();
  const inicio = new Date(instanteLocal(de, 0, cfg.fuso));
  const fim = new Date(instanteLocal(somarDias(ate, 1), 0, cfg.fuso));
  const janela = { gte: inicio, lt: fim };
  // Pago online (horario antes, link) entra como ONLINE pela data do pagamento; o lancamento
  // que isso gera na comanda fica de fora (nao conta duas vezes). Estornado depois continua no dia em que
  // foi pago; o estorno desconta no dia em que foi feito (a adquirente tira do repasse).
  const estornadas = await mensalidadesEstornadas();
  const [pagamentos, antecipados, mensalidades, links, conferidas, tx, estornos] = await Promise.all([
    db.pagamentoComanda.findMany({ where: { ...PAGAMENTO_RECEBIDO, antecipadoId: null, linkPagamentoId: null, forma: { in: ["PIX", "DEBITO", "CREDITO"] }, pagoEm: janela }, select: { forma: true, valorCentavos: true, pagoEm: true } }),
    db.pagamentoAntecipado.findMany({ where: { status: { in: ["PAGO", "CREDITADO", "ESTORNADO"] }, pagoEm: janela }, select: { valorCentavos: true, pagoEm: true } }),
    db.cobranca.findMany({ where: { OR: [{ status: "PAGA" }, { status: "ESTORNADA", id: { in: estornadas } }], pagaEm: janela }, select: { valorCentavos: true, pagaEm: true } }),
    db.linkPagamento.findMany({ where: { status: { in: ["PAGO", "ESTORNADO"] }, pagoEm: janela }, select: { valorCentavos: true, pagoEm: true } }),
    db.conciliacao.findMany({ where: { data: { gte: new Date(`${de}T00:00:00Z`), lte: new Date(`${ate}T00:00:00Z`) } } }),
    taxas(),
    estornosEfetivos(janela),
  ]);

  const bruto = new Map<string, { valor: number; qtd: number }>();
  const somar = (data: string, forma: string, valor: number) => {
    const k = `${data}|${forma}`;
    const x = bruto.get(k) ?? { valor: 0, qtd: 0 };
    bruto.set(k, { valor: x.valor + valor, qtd: x.qtd + 1 });
  };
  for (const p of pagamentos) somar(dataLocal(p.pagoEm!, cfg.fuso), p.forma, p.valorCentavos);
  for (const a of antecipados) somar(dataLocal(a.pagoEm!, cfg.fuso), "ONLINE", a.valorCentavos);
  for (const m of mensalidades) somar(dataLocal(m.pagaEm!, cfg.fuso), "ONLINE", m.valorCentavos);
  for (const l of links) somar(dataLocal(l.pagoEm!, cfg.fuso), "ONLINE", l.valorCentavos);
  const estornado = new Map<string, number>();
  for (const e of estornos) {
    if (e.forma === "DINHEIRO") continue; // dinheiro e conferido no caixa
    const k = `${dataLocal(e.executadoEm!, cfg.fuso)}|${e.forma}`;
    estornado.set(k, (estornado.get(k) ?? 0) + e.valorCentavos);
  }

  type Linha = {
    data: string; forma: FormaConciliacao; quantidade: number; brutoCentavos: number; estornoCentavos: number; taxaCentavos: number; liquidoCentavos: number;
    previstoEm: string; recebidoCentavos: number | null; diferencaCentavos: number | null; status: "PENDENTE" | "CONFERIDO" | "DIVERGENTE"; observacao: string | null;
  };
  const linhas: Linha[] = [];
  for (let d = ate; d >= de; d = somarDias(d, -1)) {
    for (const forma of FORMAS_CONCILIACAO) {
      const b = bruto.get(`${d}|${forma}`);
      const est = estornado.get(`${d}|${forma}`) ?? 0;
      const conf = conferidas.find((c) => c.forma === forma && c.data.toISOString().slice(0, 10) === d);
      if (!b && !conf && !est) continue;
      const t = tx.find((x) => x.forma === forma)!;
      // Bruto ja descontado dos estornos do dia (pode ficar negativo: a adquirente desconta do repasse).
      const valor = (b?.valor ?? 0) - est;
      const liquido = valor - taxaSobre(valor, t.taxaBps);
      const recebido = conf?.recebidoCentavos ?? null;
      linhas.push({
        data: d, forma, quantidade: b?.qtd ?? 0, brutoCentavos: valor, estornoCentavos: est, taxaCentavos: valor - liquido, liquidoCentavos: liquido,
        previstoEm: dataPrevista(d, t.prazoDias), recebidoCentavos: recebido, diferencaCentavos: recebido === null ? null : recebido - liquido,
        status: situacaoConciliacao(liquido, recebido), observacao: conf?.observacao ?? null,
      });
    }
  }
  const soma = (f: (l: Linha) => number) => linhas.reduce((t, l) => t + f(l), 0);
  return {
    linhas,
    totais: {
      bruto: soma((l) => l.brutoCentavos), estornos: soma((l) => l.estornoCentavos), liquido: soma((l) => l.liquidoCentavos),
      recebido: soma((l) => l.recebidoCentavos ?? 0), pendentes: linhas.filter((l) => l.status === "PENDENTE").length,
      divergentes: linhas.filter((l) => l.status === "DIVERGENTE").length,
    },
    taxas: tx,
  };
}

/** Registra quanto caiu na conta para o dia + forma (pode corrigir depois). */
export async function conferir(s: Sessao, p: { data: string; forma: FormaConciliacao; recebidoCentavos: number; observacao?: string | null }) {
  const { linhas } = await conciliacao(p.data, p.data);
  const l = linhas.find((x) => x.forma === p.forma);
  const liquido = l?.liquidoCentavos ?? 0;
  const status = situacaoConciliacao(liquido, p.recebidoCentavos);
  if (status === "DIVERGENTE" && !p.observacao?.trim()) {
    throw new ErroNegocio("O valor recebido não bate com o esperado. Escreva o motivo (ex.: taxa diferente, estorno).", 422, "explicar_diferenca");
  }
  const dados = {
    brutoCentavos: l?.brutoCentavos ?? 0, liquidoCentavos: liquido, recebidoCentavos: p.recebidoCentavos,
    status: status as "CONFERIDO" | "DIVERGENTE", observacao: p.observacao?.trim() || null, conferidoPorId: s.usuarioId, conferidoEm: new Date(),
  };
  await db.$transaction(async (tx) => {
    await tx.conciliacao.upsert({
      where: { data_forma: { data: new Date(`${p.data}T00:00:00Z`), forma: p.forma } },
      create: { data: new Date(`${p.data}T00:00:00Z`), forma: p.forma, ...dados },
      update: dados,
    });
    await auditar(tx, s.usuarioId, "conciliar", "financeiro", `${p.data}:${p.forma}`, { recebido: p.recebidoCentavos, liquido, status });
  });
  return { status };
}

/** Desfaz a conferencia (volta a pendente). */
export async function desfazerConferencia(s: Sessao, data: string, forma: FormaConciliacao) {
  await db.conciliacao.deleteMany({ where: { data: new Date(`${data}T00:00:00Z`), forma } });
  await auditar(db, s.usuarioId, "conciliar_desfazer", "financeiro", `${data}:${forma}`, {});
}
