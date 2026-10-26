/**
 * Caixa do balcao: abre com o fundo de troco, registra sangrias/suprimentos e fecha com a contagem.
 * O esperado em dinheiro sai dos pagamentos das comandas feitos enquanto o caixa estava aberto.
 */
import type { Caixa, Prisma } from "@prisma/client";
import { auditar } from "@/lib/auditoria";
import type { Sessao } from "@/lib/auth/sessao";
import { resumoComanda } from "@/lib/comandas/regras";
import { db } from "@/lib/db";
import { estornosEfetivos, PAGAMENTO_RECEBIDO } from "@/lib/estornos/financeiro";
import { somarPorForma } from "@/lib/estornos/regras";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import { dinheiroEsperado, semNomeFolha, totaisPorForma } from "./regras";

export const caixaAberto = () => db.caixa.findFirst({ where: { status: "ABERTO" }, orderBy: { abertoEm: "desc" } });

/** Numeros do caixa (do momento em que abriu ate fechar, ou ate agora). */
export async function resumoCaixa(c: Caixa) {
  const fim = c.fechadoEm ?? new Date();
  const janela = { gte: c.abertoEm, lte: fim };
  // Estornado depois continua contando na hora do pagamento; o estorno aparece a parte (dinheiro = sangria).
  const [pagamentos, fechadas, abertas, movimentos, estornos] = await Promise.all([
    db.pagamentoComanda.findMany({ where: { ...PAGAMENTO_RECEBIDO, pagoEm: janela }, select: { forma: true, valorCentavos: true, antecipadoId: true, linkPagamentoId: true } }),
    db.comanda.findMany({ where: { status: "FECHADA", fechadaEm: janela }, include: { itens: true, pagamentos: true } }),
    db.comanda.count({ where: { status: "ABERTA" } }),
    db.movimentoCaixa.findMany({ where: { caixaId: c.id }, orderBy: { criadoEm: "asc" } }),
    estornosEfetivos(janela),
  ]);
  const totais = totaisPorForma(pagamentos.map((p) => ({ forma: p.forma, valorCentavos: p.valorCentavos, online: !!p.antecipadoId || !!p.linkPagamentoId })));
  const troco = fechadas.reduce((t, x) => t + resumoComanda(x.itens, x.pagamentos, x.descontoCentavos).troco, 0);
  const faturado = fechadas.reduce((t, x) => t + resumoComanda(x.itens, x.pagamentos, x.descontoCentavos).total, 0);
  const suprimentos = movimentos.filter((m) => m.tipo === "SUPRIMENTO").reduce((t, m) => t + m.valorCentavos, 0);
  const sangrias = movimentos.filter((m) => m.tipo === "SANGRIA").reduce((t, m) => t + m.valorCentavos, 0);
  return {
    totais,
    troco,
    suprimentos,
    sangrias,
    /** Estornos feitos no turno por forma (dinheiro ja esta nas sangrias). */
    estornos: somarPorForma(estornos),
    esperado: dinheiroEsperado({ fundo: c.fundoCentavos, recebidoDinheiro: totais.DINHEIRO, troco, suprimentos, sangrias }),
    comandasFechadas: fechadas.length,
    faturado,
    ticketMedio: fechadas.length ? Math.round(faturado / fechadas.length) : 0,
    comandasAbertas: abertas,
    movimentos: movimentos.map((m) => ({ id: m.id, tipo: m.tipo, valorCentavos: m.valorCentavos, motivo: semNomeFolha(m.motivo), criadoEm: m.criadoEm })),
  };
}

export async function abrirCaixa(s: Sessao, fundoCentavos: number) {
  if (await caixaAberto()) throw new ErroNegocio("Já tem um caixa aberto. Feche antes de abrir outro.", 409, "ja_aberto");
  return db.$transaction(async (tx) => {
    const c = await tx.caixa.create({ data: { fundoCentavos, abertoPorId: s.usuarioId } });
    await auditar(tx, s.usuarioId, "abrir_caixa", "caixa", c.id, { fundoCentavos });
    return c;
  });
}

export async function movimentarCaixa(s: Sessao, tipo: "SANGRIA" | "SUPRIMENTO", valorCentavos: number, motivo: string) {
  const c = await caixaAberto();
  if (!c) throw new ErroNegocio("Abra o caixa primeiro.", 409, "fechado");
  if (tipo === "SANGRIA") {
    const r = await resumoCaixa(c);
    if (valorCentavos > r.esperado) throw new ErroNegocio("A sangria é maior do que o dinheiro que deveria estar no caixa.");
  }
  return db.$transaction(async (tx) => {
    const m = await tx.movimentoCaixa.create({ data: { caixaId: c.id, tipo, valorCentavos, motivo, usuarioId: s.usuarioId } });
    await auditar(tx, s.usuarioId, tipo === "SANGRIA" ? "sangria" : "suprimento", "caixa", c.id, { valorCentavos, motivo });
    return m;
  });
}

export async function fecharCaixa(s: Sessao, contadoCentavos: number, observacao?: string | null) {
  const c = await caixaAberto();
  if (!c) throw new ErroNegocio("Não tem caixa aberto.", 409, "fechado");
  const agora = new Date();
  const r = await resumoCaixa({ ...c, fechadoEm: agora });
  const diferenca = contadoCentavos - r.esperado;
  if (diferenca !== 0 && !observacao?.trim()) {
    throw new ErroNegocio(`O dinheiro contado ${diferenca > 0 ? "sobrou" : "faltou"} ${(Math.abs(diferenca) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}. Escreva uma observação para fechar.`, 422, "explicar_diferenca");
  }
  const resumo = { totais: r.totais, estornos: r.estornos, troco: r.troco, suprimentos: r.suprimentos, sangrias: r.sangrias, comandasFechadas: r.comandasFechadas, faturado: r.faturado, comandasAbertas: r.comandasAbertas };
  return db.$transaction(async (tx) => {
    const ok = await tx.caixa.updateMany({
      where: { id: c.id, status: "ABERTO" },
      data: {
        status: "FECHADO", fechadoEm: agora, fechadoPorId: s.usuarioId, contadoCentavos, esperadoCentavos: r.esperado,
        diferencaCentavos: diferenca, resumo: resumo as Prisma.InputJsonValue, observacao: observacao?.trim() || null,
      },
    });
    if (!ok.count) throw new ErroNegocio("Esse caixa já foi fechado.", 409);
    await auditar(tx, s.usuarioId, "fechar_caixa", "caixa", c.id, { contadoCentavos, esperado: r.esperado, diferenca });
    return { id: c.id, esperado: r.esperado, contado: contadoCentavos, diferenca };
  });
}

/** Caixa aberto (com o resumo ao vivo) e os ultimos fechados. */
export async function painelCaixa() {
  const [aberto, fechados] = await Promise.all([
    caixaAberto(),
    db.caixa.findMany({ where: { status: "FECHADO" }, orderBy: { fechadoEm: "desc" }, take: 30 }),
  ]);
  const nomes = new Map(
    (await db.usuario.findMany({
      where: { id: { in: [aberto?.abertoPorId, ...fechados.flatMap((f) => [f.abertoPorId, f.fechadoPorId])].filter((x): x is string => !!x) } },
      select: { id: true, nome: true },
    })).map((u) => [u.id, u.nome]),
  );
  return {
    aberto: aberto ? { id: aberto.id, abertoEm: aberto.abertoEm, fundoCentavos: aberto.fundoCentavos, abertoPor: nomes.get(aberto.abertoPorId ?? "") ?? null, ...(await resumoCaixa(aberto)) } : null,
    fechados: fechados.map((f) => ({
      id: f.id, abertoEm: f.abertoEm, fechadoEm: f.fechadoEm, fundoCentavos: f.fundoCentavos, contadoCentavos: f.contadoCentavos,
      esperadoCentavos: f.esperadoCentavos, diferencaCentavos: f.diferencaCentavos, observacao: f.observacao, resumo: f.resumo,
      abertoPor: nomes.get(f.abertoPorId ?? "") ?? null, fechadoPor: nomes.get(f.fechadoPorId ?? "") ?? null,
    })),
  };
}

export async function detalheCaixa(id: string) {
  const c = await db.caixa.findUnique({ where: { id } });
  if (!c) throw naoEncontrado("Caixa");
  return { ...c, ...(await resumoCaixa(c)) };
}
