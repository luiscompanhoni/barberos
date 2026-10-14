/**
 * Recebimento na maquininha.
 * - "manual": a equipe digita o valor na maquininha e so registra aqui (funciona com qualquer maquininha).
 * - "stone": Stone Connect 2.0 - o BarberOS manda o pedido para a maquininha pela API da Pagar.me
 *   e o webhook confirma o pagamento sozinho. Precisa de S920/Q92 ativada no Connect.
 * - "simulada": para testar sem maquininha (padrao fora de producao).
 */
import type { FormaRecebimento } from "@prisma/client";
import { auditar } from "@/lib/auditoria";
import { pode } from "@/lib/auth/permissoes";
import type { Sessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { ErroNegocio, naoEncontrado, proibido } from "@/lib/erros";
import { buscarPedido, criarPedidoMaquininha, fecharPedido, type TipoPOS } from "@/lib/pagamentos/pagarme";
import { avisarComanda, ehGerente, lancarPagamento } from "./servico";

export type ModoMaquininha = "stone" | "simulada" | "manual";

export function modoMaquininha(): ModoMaquininha {
  const m = process.env.MAQUININHA;
  if (m === "stone" || m === "simulada" || m === "manual") return m;
  return process.env.NODE_ENV === "production" ? "manual" : "simulada";
}

export const PREFIXO_SIMULADO = "sim_";
const TIPO: Partial<Record<FormaRecebimento, TipoPOS>> = { CREDITO: "credit", DEBITO: "debit", PIX: "pix" };

/** Maquininhas configuradas (STONE_POS_SERIAL separado por virgula; nomes opcionais em STONE_POS_NOMES). */
export function maquininhas() {
  const seriais = (process.env.STONE_POS_SERIAL ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const nomes = (process.env.STONE_POS_NOMES ?? "").split(",").map((x) => x.trim());
  return seriais.map((serial, i) => ({ serial, nome: nomes[i] || `Maquininha ${i + 1} (final ${serial.slice(-4)})` }));
}

function serialDaMaquininha(escolhido?: string) {
  const lista = maquininhas();
  if (!lista.length) throw new ErroNegocio("Número de série da maquininha não configurado (STONE_POS_SERIAL).", 500, "config");
  if (!escolhido) return lista[0].serial;
  if (!lista.some((m) => m.serial === escolhido)) throw new ErroNegocio("Maquininha desconhecida.", 422, "maquininha");
  return escolhido;
}

/**
 * Registra um pagamento. Dinheiro, modo manual ou "ja passei" entram como pagos.
 * Cartao/Pix com maquininha integrada ficam AGUARDANDO ate a maquininha confirmar.
 */
export async function registrarPagamento(
  s: Sessao,
  comandaId: string,
  p: { forma: FormaRecebimento; valorCentavos: number; naMaquininha: boolean; serial?: string },
) {
  const modo = modoMaquininha();
  const integrada = p.naMaquininha && p.forma !== "DINHEIRO" && modo !== "manual";

  const { comanda, pagamento } = await db.$transaction((tx) =>
    lancarPagamento(tx, s, comandaId, { forma: p.forma, valorCentavos: p.valorCentavos, status: integrada ? "AGUARDANDO" : "PAGO" }),
  );
  if (!integrada) {
    avisarComanda(comandaId);
    return pagamento;
  }

  if (modo === "simulada") {
    const r = await db.pagamentoComanda.update({ where: { id: pagamento.id }, data: { gatewayPedidoId: `${PREFIXO_SIMULADO}${pagamento.id}` } });
    avisarComanda(comandaId);
    return r;
  }

  // Stone Connect: cria o pedido na maquininha. Se falhar, o pagamento e desfeito.
  try {
    const nome = comanda.cliente?.nome || comanda.nomeAvulso || "Cliente";
    const pedido = await criarPedidoMaquininha({
      referencia: `cmd-${comanda.numero}-${pagamento.id}`,
      valorCentavos: p.valorCentavos,
      descricao: `Comanda #${comanda.numero}`,
      tipo: TIPO[p.forma]!,
      serial: serialDaMaquininha(p.serial),
      cliente: { nome, email: process.env.EMAIL_BALCAO || "balcao@barberos.app" },
      metadata: { comanda_id: comandaId, pagamento_id: pagamento.id },
    });
    const r = await db.pagamentoComanda.update({ where: { id: pagamento.id }, data: { gatewayPedidoId: pedido.id } });
    avisarComanda(comandaId);
    return r;
  } catch (e) {
    await db.pagamentoComanda.update({ where: { id: pagamento.id }, data: { status: "CANCELADO" } });
    avisarComanda(comandaId);
    if (e instanceof ErroNegocio) throw e;
    throw new ErroNegocio(`Não consegui mandar para a maquininha: ${(e as Error).message}`, 502, "maquininha");
  }
}

/** Marca como pago (so se ainda estava aguardando: idempotente para webhooks repetidos). */
async function marcarPago(pagamentoId: string, extra: { nsu?: string | null; bandeira?: string | null }) {
  const r = await db.pagamentoComanda.updateMany({
    where: { id: pagamentoId, status: "AGUARDANDO" },
    data: { status: "PAGO", pagoEm: new Date(), nsu: extra.nsu ?? null, bandeira: extra.bandeira ?? null },
  });
  return r.count > 0;
}

/**
 * Confere na Pagar.me o pedido da maquininha e atualiza o pagamento (webhook ou botao "conferir").
 * Devolve true se o pedido era de uma comanda.
 */
export async function sincronizarPedido(pedidoId: string) {
  const pg = await db.pagamentoComanda.findUnique({ where: { gatewayPedidoId: pedidoId } });
  if (!pg) return false;
  if (pg.status !== "AGUARDANDO" || pedidoId.startsWith(PREFIXO_SIMULADO)) return true;

  const pedido = await buscarPedido(pedidoId);
  const pago = pedido.charges?.find((c) => c.status === "paid");
  if (pedido.status === "paid" || pago) {
    if (await marcarPago(pg.id, { nsu: pago?.code ?? null, bandeira: pago?.metadata?.schemeName ?? null })) avisarComanda(pg.comandaId);
    // Sempre fechar: pedido aberto continua ocupando a fila da maquininha (limite de 30).
    await fecharPedido(pedidoId, "paid").catch((e) => console.error("[maquininha] fechar pedido", pedidoId, e));
  } else if (pedido.status === "canceled" || pedido.status === "failed") {
    await db.pagamentoComanda.updateMany({ where: { id: pg.id, status: "AGUARDANDO" }, data: { status: "CANCELADO" } });
    avisarComanda(pg.comandaId);
  }
  return true;
}

/**
 * Desiste de um pagamento: tira da maquininha (se estava esperando: quem lancou ou a gerencia)
 * ou, so o dono, desfaz um lancamento errado (sem dinheiro envolvido). Devolver dinheiro recebido
 * e estorno (lib/estornos): a recepcao pede e o dono aprova.
 */
export async function cancelarPagamento(s: Sessao, pagamentoId: string) {
  const pg = await db.pagamentoComanda.findUnique({ where: { id: pagamentoId }, include: { comanda: { select: { status: true } } } });
  if (!pg) throw naoEncontrado("Pagamento");
  if (pg.comanda.status !== "ABERTA") throw new ErroNegocio("A comanda já foi fechada.");
  if (pg.status === "CANCELADO") return;
  if (pg.antecipadoId) throw new ErroNegocio("Esse valor foi pago online antes do atendimento: não dá para desfazer. Para devolver, use “Pedir estorno”.", 409, "antecipado");
  if (pg.linkPagamentoId) throw new ErroNegocio("Esse valor foi pago pelo link de pagamento: não dá para desfazer. Para devolver, use “Pedir estorno”.", 409, "link");
  if (pg.status === "PAGO") {
    if (!(await pode(s, "estorno"))) throw new ErroNegocio("Pagamento já recebido: peça o estorno ao dono (botão “Pedir estorno”).", 403, "pedir_estorno");
    if (pg.gatewayPedidoId && !pg.gatewayPedidoId.startsWith(PREFIXO_SIMULADO)) {
      throw new ErroNegocio("Pagamento aprovado na maquininha: para devolver, use “Estornar”.", 409, "usar_estorno");
    }
    if (pg.estornadoCentavos > 0) throw new ErroNegocio("Esse pagamento já tem estorno: não dá para desfazer.", 409, "estornado");
    const pedido = await db.pedidoEstorno.findFirst({ where: { tipo: "COMANDA", referenciaId: pg.id, status: { in: ["PENDENTE", "APROVADO", "FALHOU"] } } });
    if (pedido) throw new ErroNegocio("Esse pagamento tem um pedido de estorno em aberto: decida o pedido primeiro.", 409, "estorno_aberto");
  } else if (pg.registradoPorId !== s.usuarioId && !ehGerente(s)) {
    throw proibido();
  }
  if (pg.status === "AGUARDANDO" && pg.gatewayPedidoId && !pg.gatewayPedidoId.startsWith(PREFIXO_SIMULADO)) {
    await fecharPedido(pg.gatewayPedidoId, "canceled").catch((e) => {
      throw new ErroNegocio(`A maquininha não confirmou o cancelamento: ${(e as Error).message}`, 502, "maquininha");
    });
  }
  await db.$transaction(async (tx) => {
    await tx.pagamentoComanda.update({ where: { id: pagamentoId }, data: { status: "CANCELADO" } });
    await auditar(tx, s.usuarioId, "cancelar_pagamento", "comanda", pg.comandaId, { pagamentoId, estava: pg.status, valorCentavos: pg.valorCentavos });
  });
  avisarComanda(pg.comandaId);
}

/** So no modo simulado: faz de conta que o cliente passou o cartao. */
export async function simularAprovacao(pagamentoId: string) {
  if (modoMaquininha() !== "simulada") throw new ErroNegocio("Simulação desligada.", 403, "proibido");
  const pg = await db.pagamentoComanda.findUnique({ where: { id: pagamentoId } });
  if (!pg) throw naoEncontrado("Pagamento");
  if (await marcarPago(pg.id, { nsu: String(Date.now()).slice(-6), bandeira: pg.forma === "PIX" ? "Pix" : "Visa" })) avisarComanda(pg.comandaId);
}
