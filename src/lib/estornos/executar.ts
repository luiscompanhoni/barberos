/**
 * Executa um estorno aprovado: devolve o dinheiro pelo meio certo e aplica os efeitos
 * (pagamento da comanda, horario, link, mensalidade). Resultado incerto fica em conferência.
 */
import type { PedidoEstorno, Prisma } from "@prisma/client";
import { ehHomologacao } from "@/lib/ambiente";
import { auditar } from "@/lib/auditoria";
import type { Sessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { ErroNegocio, proibido } from "@/lib/erros";
import { publicar } from "@/lib/eventos";
import { movimentarCaixa } from "@/lib/financeiro/caixa";
import { estornarCobranca } from "@/lib/pagamentos/pagarme";
import { carregarAlvo, type Alvo } from "./alvo";
import { instrucaoManual, STATUS_EFETIVOS, statusDoRetorno, type MeioEstorno } from "./regras";
import { conferirComprovante, reservarExecucao, travarEstorno, validarSaldoEstorno } from "./execucao-estado";

type Tx = Prisma.TransactionClient;
type Resultado = { status: "APROVADO" | "EXECUTADO" | "MANUAL"; gatewayEstornoId?: string | null; instrucao?: string | null; movimentoCaixaId?: string | null };
const MANUAIS = ["MAQUININHA", "CELCASH", "ASAAS", "FORA"];
const CONFERIR = "Resultado da devolução em conferência. Não repetir nem realizar outra transferência; confira o provedor/caixa e registre o comprovante da devolução efetiva.";

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
    case "SIMULADO": {
      // Online simulado: a cobranca de teste vira estornada. Maquininha simulada: nada a fazer.
      if (alvo.gatewayId && !alvo.gatewayId.startsWith("sim_")) {
        await db.cobrancaSimulada.updateMany({ where: { id: alvo.gatewayId }, data: { status: "ESTORNADA" } });
      }
      return { status: "EXECUTADO", gatewayEstornoId: `simest_${p.id}` };
    }
    default:
      // Celcash/Asaas (sem estorno pela API no BarberOS) ou lancado sem integracao.
      return { status: "APROVADO", instrucao: instrucaoManual(p.meio as MeioEstorno, p.valorCentavos, alvo.gatewayId) };
  }
}

/** Marca o pagamento da comanda como (parcial ou totalmente) estornado. */
async function estornarNaComanda(tx: Tx, pagamentoId: string, valor: number, quando: Date) {
  const pg = await tx.pagamentoComanda.findUniqueOrThrow({ where: { id: pagamentoId } });
  const estornado = pg.estornadoCentavos + valor;
  if (estornado > pg.valorCentavos) throw new ErroNegocio("Valor já devolvido. Confira o histórico antes de confirmar.", 409, "estorno_conciliado");
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

/** Reivindica uma vez antes do efeito externo. Instrução persistida impede reenvio após timeout/reinício. */
export async function executarEstorno(s: Sessao, pedidoId: string) {
  const p = await db.pedidoEstorno.findUniqueOrThrow({ where: { id: pedidoId } });
  if (p.status !== "APROVADO" || p.instrucao !== null) return p;
  if (ehHomologacao() && p.meio === "PAGARME") throw new ErroNegocio("Homologação não envia estornos reais. Use pagamentos de origem simulada para este teste.", 409, "homologacao");
  const alvo = await carregarAlvo(p.tipo, p.referenciaId);
  const manual = MANUAIS.includes(p.meio);
  const reservou = await db.$transaction(async tx => {
    await travarEstorno(tx, p, alvo);
    const atual = await tx.pedidoEstorno.findUniqueOrThrow({ where: { id: p.id } });
    if (atual.status !== "APROVADO" || atual.instrucao !== null) return false;
    const a = await carregarAlvo(p.tipo, p.referenciaId, tx);
    if (a.bloqueio) throw new ErroNegocio(a.bloqueio, 409, "nao_estornavel");
    await validarSaldoEstorno(tx, p, a);
    return reservarExecucao(tx, p, s.usuarioId, manual ? instrucaoManual(p.meio as MeioEstorno, p.valorCentavos, alvo.gatewayId) : CONFERIR);
  });
  if (!reservou || manual) return db.pedidoEstorno.findUniqueOrThrow({ where: { id: p.id } });

  let r: Resultado;
  try {
    r = await devolver(s, p, alvo);
  } catch {
    // Rede e falha de persistência não provam que dinheiro deixou de sair.
    await db.$transaction(async (tx) => {
      const ok = await tx.pedidoEstorno.updateMany({ where: { id: p.id, status: "APROVADO" }, data: { instrucao: CONFERIR, erro: "O resultado externo não foi confirmado. Não reenviar." } });
      if (ok.count) await auditar(tx, s.usuarioId, "estorno_resultado_incerto", "estorno", p.id, { meio: p.meio });
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
      await travarEstorno(tx, p, alvo);
      const atual = await tx.pedidoEstorno.findUniqueOrThrow({ where: { id: p.id } });
      if (!["APROVADO", "FALHOU"].includes(atual.status)) return;
      if (r.status !== "APROVADO") await validarSaldoEstorno(tx, p, await carregarAlvo(p.tipo, p.referenciaId, tx));
      if (r.status === "MANUAL") await conferirComprovante(tx, s.usuarioId, p, r.instrucao!);
      const ok = await tx.pedidoEstorno.updateMany({
        where: { id: p.id, status: { in: ["APROVADO", "FALHOU"] } },
        data: {
          status: r.status, ...(r.status !== "APROVADO" ? { executadoEm: agora } : {}), erro: null,
          ...(r.gatewayEstornoId ? { gatewayEstornoId: r.gatewayEstornoId } : {}),
          instrucao: r.instrucao ?? null, ...(r.movimentoCaixaId ? { movimentoCaixaId: r.movimentoCaixaId } : {}),
        },
      });
      if (!ok.count) return;
      if (r.status !== "APROVADO") await aplicarEfeitos(tx, p, alvo, agora);
      await auditar(tx, s.usuarioId, r.status === "MANUAL" ? "estorno_manual" : r.status === "APROVADO" ? "estorno_em_conferencia" : "estorno_executado", "estorno", p.id, {
        tipo: p.tipo, referenciaId: p.referenciaId, valorCentavos: p.valorCentavos, meio: p.meio,
        gatewayEstornoId: r.gatewayEstornoId ?? null, movimentoCaixaId: r.movimentoCaixaId ?? null,
        ...(r.status === "MANUAL" ? { referenciaComprovante: r.instrucao } : {}),
      });
    });
  } catch (e) {
    if (e instanceof ErroNegocio) throw e;
    // Dinheiro ja saiu (sangria/gateway) mas nao deu para gravar: deixa registrado para o dono conferir.
    await db.$transaction(async (tx) => {
      const ok = await tx.pedidoEstorno.updateMany({ where: { id: p.id, status: { in: ["APROVADO", "FALHOU"] } }, data: {
        status: "APROVADO", instrucao: CONFERIR, erro: "Houve falha ao registrar o retorno. Confira o comprovante antes de qualquer nova devolução.",
        ...(r.gatewayEstornoId ? { gatewayEstornoId: r.gatewayEstornoId } : {}), ...(r.movimentoCaixaId ? { movimentoCaixaId: r.movimentoCaixaId } : {}),
      } });
      if (ok.count) await auditar(tx, s.usuarioId, "estorno_resultado_incerto", "estorno", p.id, { meio: p.meio });
    });
  }
  if (alvo.comandaId) publicar({ tipo: "comanda", comandaId: alvo.comandaId });
  return db.pedidoEstorno.findUniqueOrThrow({ where: { id: p.id } });
}

/** Meio falhou e o dono devolveu por fora: registra como MANUAL e aplica os efeitos. */
export async function registrarManual(s: Sessao, pedidoId: string, observacao?: string | null) {
  if (s.papel !== "DONO") throw proibido();
  const p = await db.pedidoEstorno.findUniqueOrThrow({ where: { id: pedidoId } });
  if (p.status !== "FALHOU" && p.status !== "APROVADO") {
    throw new ErroNegocio("Esse estorno já mudou. Atualize a tela.", 409, "ja_decidido");
  }
  const referencia = observacao?.trim().normalize("NFKC").replace(/\s+/g, " ");
  if (!referencia || referencia.length < 3 || referencia.length > 300) {
    throw new ErroNegocio("Informe a referência do comprovante da devolução efetiva.", 422, "comprovante_estorno");
  }
  if (p.meio === "DINHEIRO" && !p.movimentoCaixaId) throw new ErroNegocio("Confira a sangria no caixa com a gerência antes de registrar a devolução. Não repetir a saída.", 409, "sangria_nao_conciliada");
  const alvo = await carregarAlvo(p.tipo, p.referenciaId);
  return concluir(s, p, alvo, { status: "MANUAL", instrucao: referencia, movimentoCaixaId: p.movimentoCaixaId });
}
