/**
 * Extrato do caixa: tudo o que aconteceu no turno, em ordem, com o saldo de dinheiro na gaveta linha a linha.
 * Usa a mesma janela do resumoCaixa (abertura ate o fechamento ou agora), entao o saldo final bate com o esperado.
 */
import { resumoComanda } from "@/lib/comandas/regras";
import { db } from "@/lib/db";
import { naoEncontrado } from "@/lib/erros";
import { estornosEfetivos, PAGAMENTO_RECEBIDO } from "@/lib/estornos/financeiro";
import { montarExtrato, ROTULO_CATEGORIA, type EventoExtrato } from "./regras";

export async function extratoCaixa(caixaId: string) {
  const c = await db.caixa.findUnique({ where: { id: caixaId }, include: { movimentos: true } });
  if (!c) throw naoEncontrado("Caixa");
  const janela = { gte: c.abertoEm, lte: c.fechadoEm ?? new Date() };
  const comandaSel = { select: { numero: true, nomeAvulso: true, cliente: { select: { nome: true } } } };
  const [pagamentos, fechadas, despesas, usuarios, estornos] = await Promise.all([
    db.pagamentoComanda.findMany({ where: { ...PAGAMENTO_RECEBIDO, pagoEm: janela }, include: { comanda: comandaSel } }),
    db.comanda.findMany({ where: { status: "FECHADA", fechadaEm: janela }, include: { itens: true, pagamentos: true, cliente: { select: { nome: true } } } }),
    db.despesa.findMany({ where: { movimentoCaixaId: { in: c.movimentos.map((m) => m.id) } } }),
    db.usuario.findMany({ where: { id: { in: [c.abertoPorId, c.fechadoPorId].filter((x): x is string => !!x) } }, select: { id: true, nome: true } }),
    estornosEfetivos(janela),
  ]);
  const nome = (id: string | null) => usuarios.find((u) => u.id === id)?.nome ?? null;

  const eventos: EventoExtrato[] = [{ tipo: "ABERTURA", em: c.abertoEm, descricao: "Abertura do caixa (fundo de troco)", valorCentavos: c.fundoCentavos, dinheiro: true }];
  for (const p of pagamentos) {
    eventos.push({
      tipo: "PAGAMENTO", em: p.pagoEm!, descricao: `Comanda #${p.comanda.numero}`, valorCentavos: p.valorCentavos,
      dinheiro: p.forma === "DINHEIRO" && !p.antecipadoId && !p.linkPagamentoId, forma: p.forma, comanda: p.comanda.numero,
      cliente: p.comanda.cliente?.nome ?? p.comanda.nomeAvulso ?? null, online: !!p.antecipadoId || !!p.linkPagamentoId,
    });
  }
  for (const x of fechadas) {
    const { troco } = resumoComanda(x.itens, x.pagamentos, x.descontoCentavos);
    if (troco > 0) {
      eventos.push({ tipo: "TROCO", em: x.fechadaEm!, descricao: `Troco da comanda #${x.numero}`, valorCentavos: troco, dinheiro: true, forma: "DINHEIRO", comanda: x.numero, cliente: x.cliente?.nome ?? x.nomeAvulso ?? null });
    }
  }
  // Estorno: em dinheiro e a propria sangria (sai da gaveta); nos outros meios so aparece (nao mexe na gaveta).
  for (const e of estornos) {
    if (e.movimentoCaixaId && c.movimentos.some((m) => m.id === e.movimentoCaixaId)) continue;
    eventos.push({ tipo: "ESTORNO", em: e.executadoEm!, descricao: `Estorno: ${e.descricao}`, valorCentavos: e.valorCentavos, dinheiro: false, forma: e.forma === "ONLINE" ? null : e.forma, cliente: e.clienteNome, online: e.forma === "ONLINE" });
  }
  for (const m of c.movimentos) {
    const d = despesas.find((x) => x.movimentoCaixaId === m.id);
    const est = estornos.find((x) => x.movimentoCaixaId === m.id);
    if (est) {
      eventos.push({ tipo: "ESTORNO", em: m.criadoEm, descricao: `Estorno em dinheiro: ${est.descricao}`, valorCentavos: m.valorCentavos, dinheiro: true, forma: "DINHEIRO", cliente: est.clienteNome });
      continue;
    }
    eventos.push(d
      ? { tipo: "DESPESA", em: m.criadoEm, descricao: `Despesa: ${d.descricao} (${ROTULO_CATEGORIA[d.categoria] ?? d.categoria})`, valorCentavos: m.valorCentavos, dinheiro: true, forma: "DINHEIRO" }
      : { tipo: m.tipo, em: m.criadoEm, descricao: `${m.tipo === "SANGRIA" ? "Sangria" : "Suprimento"}: ${m.motivo}`, valorCentavos: m.valorCentavos, dinheiro: true, forma: "DINHEIRO" });
  }
  if (c.status === "FECHADO" && c.fechadoEm) {
    eventos.push({
      tipo: "FECHAMENTO", em: c.fechadoEm, descricao: "Fechamento do caixa (dinheiro contado)", valorCentavos: c.contadoCentavos ?? 0, dinheiro: false,
      contado: c.contadoCentavos, esperado: c.esperadoCentavos, diferenca: c.diferencaCentavos,
    });
  }
  const linhas = montarExtrato(eventos);
  const semFechamento = linhas.filter((l) => l.tipo !== "FECHAMENTO");
  return {
    caixa: {
      id: c.id, status: c.status, abertoEm: c.abertoEm, fechadoEm: c.fechadoEm, fundoCentavos: c.fundoCentavos, abertoPor: nome(c.abertoPorId),
      fechadoPor: nome(c.fechadoPorId), contadoCentavos: c.contadoCentavos, esperadoCentavos: c.esperadoCentavos, diferencaCentavos: c.diferencaCentavos, observacao: c.observacao,
    },
    linhas,
    saldoDinheiro: semFechamento.at(-1)?.saldoCentavos ?? 0,
  };
}
