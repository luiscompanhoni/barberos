/**
 * Executa um estorno aprovado: devolve o dinheiro pelo meio certo e aplica os efeitos
 * (pagamento da comanda, horario, link, mensalidade). Falha do gateway = FALHOU (nada muda).
 */
import type { PedidoEstorno, Prisma } from "@prisma/client";
import { auditar } from "@/lib/auditoria";
import type { Sessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { publicar } from "@/lib/eventos";
import { movimentarCaixa } from "@/lib/financeiro/caixa";
import { estornarCobranca } from "@/lib/pagamentos/pagarme";
import { carregarAlvo, type Alvo } from "./alvo";
import { instrucaoManual, STATUS_EFETIVOS, statusDoRetorno, type MeioEstorno } from "./regras";

type Tx = Prisma.TransactionClient;
type Resultado = { status: "EXECUTADO" | "MANUAL"; gatewayEstornoId?: string | null; instrucao?: string | null; movimentoCaixaId?: string | null };

/** Devolve o dinheiro no meio de pagamento. Lanca erro se o meio recusar. */
async function devolver(s: Sessao, p: PedidoEstorno, alvo: Alvo): Promise<Resultado> {
  const parcial = p.valorCentavos < p.valorOriginalCentavos;
  switch (p.meio as MeioEstorno) {
    case "DINHEIRO": {
      const m = await movimentarCaixa(s, "SANGRIA", p.valorCentavos, `Estorno: ${p.descricao} - ${p.motivo}`.slice(0, 200));
      return { status: "EXECUTADO", movimentoCaixaId: m.id };
    }
    case "PAGARME": {
      const r = await estornarCobranca(alvo.gatewayId!, parcial ? p.valorCentavos : undefined);
      return { ...statusDoRetorno(r), gatewayEstornoId: r.estornoId };
    }
    case "MAQUININHA": {
      // Stone Connect: tenta pela API; se nao der, o estorno e feito na propria maquininha.
      try {
        const r = await estornarCobranca(alvo.gatewayId!, parcial ? p.valorCentavos : undefined);
        return { ...statusDoRetorno(r), gatewayEstornoId: r.estornoId };
      } catch (e) {
        return { status: "MANUAL", instrucao: instrucaoManual("MAQUININHA", p.valorCentavos, `a API não cancelou: ${(e as Error).message}`) };
      }
    }
    case "SIMULADO": {
      // Online simulado: a cobranca de teste vira estornada. Maquininha simulada: nada a fazer.
      if (alvo.gatewayId && !alvo.gatewayId.startsWith("sim_")) {
        await db.cobrancaSimulada.updateMany({ where: { id: alvo.gatewayId }, data: { status: "ESTORNADA" } });
      }
      return { status: "EXECUTADO", gatewayEstornoId: `simest_${p.id}` };
    }
    default:
      // Celcash/Asaas (sem estorno pela API no BarberOS) ou lancado sem integracao.
      return { status: "MANUAL", instrucao: instrucaoManual(p.meio as MeioEstorno, p.valorCentavos, alvo.gatewayId) };
  }
}

/** Marca o pagamento da comanda como (parcial ou totalmente) estornado. */
async function estornarNaComanda(tx: Tx, pagamentoId: string, valor: number, quando: Date) {
  const pg = await tx.pagamentoComanda.findUniqueOrThrow({ where: { id: pagamentoId } });
  const estornado = Math.min(pg.valorCentavos, pg.estornadoCentavos + valor);
  await tx.pagamentoComanda.update({
    where: { id: pagamentoId },
    data: { estornadoCentavos: estornado, estornadoEm: quando, ...(estornado >= pg.valorCentavos ? { status: "CANCELADO" as const } : {}) },
  });
}

/** Efeitos no banco depois do dinheiro devolvido. */
async function aplicarEfeitos(tx: Tx, p: PedidoEstorno, alvo: Alvo, quando: Date) {
  const anteriores = await tx.pedidoEstorno.aggregate({
    where: { tipo: p.tipo, referenciaId: p.referenciaId, status: { in: STATUS_EFETIVOS }, id: { not: p.id } },
    _sum: { valorCentavos: true },
  });
  const total = (anteriores._sum.valorCentavos ?? 0) + p.valorCentavos >= p.valorOriginalCentavos;
  if (alvo.pagamentoComandaId) await estornarNaComanda(tx, alvo.pagamentoComandaId, p.valorCentavos, quando);
  if (!total) return;
  // Estorno total: o registro de origem deixa de contar como pago.
  if (p.tipo === "ANTECIPADO") await tx.pagamentoAntecipado.update({ where: { id: p.referenciaId }, data: { status: "ESTORNADO" } });
  else if (p.tipo === "LINK") await tx.linkPagamento.update({ where: { id: p.referenciaId }, data: { status: "ESTORNADO" } });
  else if (p.tipo === "MENSALIDADE") await tx.cobranca.update({ where: { id: p.referenciaId }, data: { status: "ESTORNADA" } });
}

/** Executa um pedido APROVADO (quem chama acabou de aprovar: so ele executa). */
export async function executarEstorno(s: Sessao, pedidoId: string) {
  const p = await db.pedidoEstorno.findUniqueOrThrow({ where: { id: pedidoId } });
  if (p.status !== "APROVADO") return p;
  const alvo = await carregarAlvo(p.tipo, p.referenciaId);

  let r: Resultado;
  try {
    if (alvo.bloqueio) throw new Error(alvo.bloqueio);
    r = await devolver(s, p, alvo);
  } catch (e) {
    const erro = (e as Error).message.slice(0, 500);
    await db.$transaction(async (tx) => {
      await tx.pedidoEstorno.update({ where: { id: p.id }, data: { status: "FALHOU", erro } });
      await auditar(tx, s.usuarioId, "estorno_falhou", "estorno", p.id, { erro, meio: p.meio });
    });
    return db.pedidoEstorno.findUniqueOrThrow({ where: { id: p.id } });
  }
  return concluir(s, p, alvo, r);
}

/** Grava o resultado e os efeitos numa transacao so. */
async function concluir(s: Sessao, p: PedidoEstorno, alvo: Alvo, r: Resultado) {
  const agora = new Date();
  try {
    await db.$transaction(async (tx) => {
      const ok = await tx.pedidoEstorno.updateMany({
        where: { id: p.id, status: { in: ["APROVADO", "FALHOU"] } },
        data: {
          status: r.status, executadoEm: agora, erro: null, gatewayEstornoId: r.gatewayEstornoId ?? null,
          instrucao: r.instrucao ?? null, movimentoCaixaId: r.movimentoCaixaId ?? null,
        },
      });
      if (!ok.count) throw new Error("Esse estorno mudou enquanto era executado.");
      await aplicarEfeitos(tx, p, alvo, agora);
      await auditar(tx, s.usuarioId, r.status === "MANUAL" ? "estorno_manual" : "estorno_executado", "estorno", p.id, {
        tipo: p.tipo, referenciaId: p.referenciaId, valorCentavos: p.valorCentavos, meio: p.meio,
        gatewayEstornoId: r.gatewayEstornoId ?? null, movimentoCaixaId: r.movimentoCaixaId ?? null,
      });
    });
  } catch (e) {
    // Dinheiro ja saiu (sangria/gateway) mas nao deu para gravar: deixa registrado para o dono conferir.
    const erro = `Devolvido (${r.gatewayEstornoId ?? r.movimentoCaixaId ?? r.status}), mas falhou ao registrar: ${(e as Error).message}`.slice(0, 500);
    await db.pedidoEstorno.update({ where: { id: p.id }, data: { status: "FALHOU", erro } });
    await auditar(db, s.usuarioId, "estorno_falhou", "estorno", p.id, { erro });
  }
  if (alvo.comandaId) publicar({ tipo: "comanda", comandaId: alvo.comandaId });
  return db.pedidoEstorno.findUniqueOrThrow({ where: { id: p.id } });
}

/** Meio falhou e o dono devolveu por fora: registra como MANUAL e aplica os efeitos. */
export async function registrarManual(s: Sessao, pedidoId: string, observacao?: string | null) {
  const p = await db.pedidoEstorno.findUniqueOrThrow({ where: { id: pedidoId } });
  const alvo = await carregarAlvo(p.tipo, p.referenciaId);
  return concluir(s, p, alvo, { status: "MANUAL", instrucao: observacao?.trim() || instrucaoManual(p.meio as MeioEstorno, p.valorCentavos, alvo.gatewayId) });
}
