/**
 * Recebimento na maquininha.
 * - "manual": a equipe digita o valor na maquininha e so registra aqui (funciona com qualquer maquininha).
 * - "stone": Stone Connect 2.0 - o BarberOS manda o pedido para a maquininha pela API da Pagar.me
 *   e o webhook confirma o pagamento. Exige conta, terminal e aplicativo habilitados/homologados.
 * - "simulada": para testar sem maquininha (padrao fora de producao).
 */
import type { FormaRecebimento } from "@prisma/client";
import { ehHomologacao } from "@/lib/ambiente";
import { auditar } from "@/lib/auditoria";
import { pode } from "@/lib/auth/permissoes";
import { BALCAO, type Sessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { ErroNegocio, naoEncontrado, proibido } from "@/lib/erros";
import { buscarPedido, criarPedidoMaquininha, ErroPagarme, fecharPedido, type TipoPOS } from "@/lib/pagamentos/pagarme";
import { exigirEmissaoDeCobranca } from "@/lib/pagamentos/bloqueio-cobranca";
import { configuracaoStonePOS } from "@/lib/pagamentos/pagarme-pos-config";
import { z } from "zod";
import { travarAgendaComanda } from "./agenda-comanda";
import { comandaPosDoBarbeiro, formaCartaoPresencial } from "./maquininha-acesso";
import { conferirValoresPOS, referenciaPOS, ultimoInstantePOS } from "./maquininha-regras";
import { conciliarEstornoPOS } from "./maquininha-estornos";
import { avisarComanda, ehGerente, lancarPagamento } from "./servico";

export type ModoMaquininha = "stone" | "simulada" | "manual";

export function modoMaquininha(): ModoMaquininha {
  if (ehHomologacao()) return "simulada";
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
  p: { forma: FormaRecebimento; valorCentavos: number; naMaquininha: boolean; serial?: string; solicitacaoId?: string },
) {
  const modo = modoMaquininha();
  const balcao = BALCAO.includes(s.papel);
  if (!balcao && (s.papel !== "BARBEIRO" || !s.barbeiroId || modo !== "stone"
    || !p.naMaquininha || !formaCartaoPresencial(p.forma) || p.serial !== undefined)) throw proibido();
  if (p.naMaquininha && (modo === "manual" || p.forma === "DINHEIRO")) {
    throw new ErroNegocio("A cobrança solicitada exige uma maquininha integrada. Confira o modo de recebimento.", 409, "maquininha_desativada");
  }
  const integrada = p.naMaquininha;
  // Erros locais conhecidos não deixam uma intenção que nunca foi enviada.
  const real = integrada && modo === "stone";
  if (real) exigirEmissaoDeCobranca("stone");
  const serial = real ? serialDaMaquininha(p.serial) : undefined;
  if (real && !process.env.PAGARME_SECRET_KEY?.trim()) throw new ErroNegocio("Integração da maquininha não configurada.", 503, "config");
  const stone = real ? configuracaoStonePOS() : undefined;
  const chave = real ? z.uuid().safeParse(p.solicitacaoId) : null;
  if (chave && !chave.success) throw new ErroNegocio("Atualize a tela para iniciar uma solicitação identificada.", 409, "solicitacao_pos");
  const id = chave?.success ? `pos_${chave.data.replaceAll("-", "").toLowerCase()}` : undefined;
  const { comanda, pagamento, existente } = await db.$transaction(async (tx) => {
    if (!balcao) await travarAgendaComanda(tx, comandaId);
    await tx.$queryRaw`SELECT 1 FROM comandas WHERE id = ${comandaId} FOR UPDATE`;
    if (!balcao && !await comandaPosDoBarbeiro(s, comandaId, tx)) throw proibido();
    if (id) {
      const anterior = await tx.pagamentoComanda.findUnique({ where: { id } });
      if (anterior) {
        if (anterior.comandaId !== comandaId || anterior.registradoPorId !== s.usuarioId
          || anterior.forma !== p.forma || anterior.valorCentavos !== p.valorCentavos) {
          throw new ErroNegocio("A solicitação já foi usada com outros dados. Confira o pagamento antes de prosseguir.", 409, "solicitacao_pos");
        }
        return { pagamento: anterior, comanda: null, existente: true };
      }
    }
    const pendente = await tx.pagamentoComanda.findFirst({ where: { comandaId, status: "AGUARDANDO" } });
    if (pendente) {
      if (integrada && !id && pendente.forma === p.forma && pendente.valorCentavos === p.valorCentavos) {
        return { pagamento: pendente, comanda: null, existente: true };
      }
      throw new ErroNegocio("Há uma cobrança aguardando confirmação. Confira ou cancele antes de cobrar novamente.", 409, "pagamento_pendente");
    }
    const link = await tx.linkPagamento.findFirst({ where: { comandaId, status: "PENDENTE", OR: [{ expiraEm: { gt: new Date() } }, { gatewayId: { not: null } }, { tentativaChave: { not: null } }] }, select: { id: true } });
    if (link) throw new ErroNegocio("Há um link de pagamento ativo. Confira ou cancele o link antes de cobrar na comanda.", 409, "link_pendente");
    return { ...(await lancarPagamento(tx, s, comandaId, { id, forma: p.forma, valorCentavos: p.valorCentavos, status: integrada ? "AGUARDANDO" : "PAGO" })), existente: false };
  });
  if (existente) return pagamento;
  if (!integrada) {
    avisarComanda(comandaId);
    return pagamento;
  }

  if (modo === "simulada") {
    const r = await db.pagamentoComanda.update({ where: { id: pagamento.id }, data: { gatewayPedidoId: `${PREFIXO_SIMULADO}${pagamento.id}` } });
    avisarComanda(comandaId);
    return r;
  }

  // Timeout não comprova falha: preservar a intenção impede nova cobrança por engano.
  try {
    const nome = comanda!.cliente?.nome || comanda!.nomeAvulso || "Cliente";
    const referencia = referenciaPOS(comanda!.numero, pagamento.id);
    const pedido = await criarPedidoMaquininha({
      referencia,
      valorCentavos: p.valorCentavos,
      descricao: `Comanda #${comanda!.numero}`,
      tipo: TIPO[p.forma]!,
      serial: serial!,
      cliente: { nome, email: process.env.EMAIL_BALCAO || "balcao@barberos.app" },
      metadata: { comanda_id: comandaId, pagamento_id: pagamento.id },
    }, stone);
    if (!pedido.id?.startsWith("or_")) throw new Error("Pedido sem identificação no retorno.");
    if ((pedido.code && pedido.code !== referencia) || (pedido.amount !== undefined && pedido.amount !== p.valorCentavos)
      || (pedido.currency && pedido.currency !== "BRL") || (pedido.metadata?.pagamento_id && pedido.metadata.pagamento_id !== pagamento.id)
      || (pedido.metadata?.comanda_id && pedido.metadata.comanda_id !== comandaId)) throw new Error("Pedido divergente no retorno da criação.");
    await db.pagamentoComanda.updateMany({ where: { id: pagamento.id, gatewayPedidoId: null }, data: { gatewayPedidoId: pedido.id } });
    const r = await db.pagamentoComanda.findUniqueOrThrow({ where: { id: pagamento.id } });
    if (r.gatewayPedidoId !== pedido.id) throw new Error("Pedido divergente do vínculo recuperado.");
    avisarComanda(comandaId);
    return r;
  } catch (e) {
    // Rejeição explícita de entrada/autorização não criou um pedido. 409/5xx/rede são incertos.
    const recusado = e instanceof ErroPagarme && [400, 401, 403, 404, 422].includes(e.status);
    if (recusado) await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM comandas WHERE id = ${comandaId} FOR UPDATE`;
      const r = await tx.pagamentoComanda.updateMany({ where: { id: pagamento.id, status: "AGUARDANDO", gatewayPedidoId: null }, data: { status: "CANCELADO" } });
      if (r.count) await auditar(tx, s.usuarioId, "maquininha_pedido_recusado", "comanda", comandaId, { pagamentoId: pagamento.id, httpStatus: e.status });
    });
    avisarComanda(comandaId);
    throw new ErroNegocio(recusado
      ? "A maquininha recusou a criação da cobrança. Confira a configuração com a gerência."
      : "Não foi possível confirmar o envio à maquininha. A cobrança continua em conferência; não cobre novamente. Aguarde o retorno ou confira o pedido com a gerência.",
    502, recusado ? "maquininha" : "maquininha_incerta");
  }
}

/** Confirma uma vez; prova autoritativa também pode revelar aprovação após cancelamento local. */
async function marcarPago(pagamentoId: string, extra: { nsu?: string | null; bandeira?: string | null; gatewaySimulado?: string; pagoEm?: Date }, aceitarTardia = false) {
  const pg = await db.pagamentoComanda.findUniqueOrThrow({ where: { id: pagamentoId } });
  const resultado = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM comandas WHERE id = ${pg.comandaId} FOR UPDATE`;
    const atual = await tx.pagamentoComanda.findUniqueOrThrow({ where: { id: pagamentoId } });
    const pagoEm = atual.pagoEm ?? extra.pagoEm ?? new Date();
    const r = await tx.pagamentoComanda.updateMany({
      where: { id: pagamentoId, status: aceitarTardia ? { in: ["AGUARDANDO", "CANCELADO"] } : "AGUARDANDO", estornadoCentavos: 0,
        ...(extra.gatewaySimulado ? { gatewayPedidoId: extra.gatewaySimulado } : {}) },
      data: { status: "PAGO", pagoEm, nsu: extra.nsu ?? null, bandeira: extra.bandeira ?? null },
    });
    const tardia = r.count > 0 && atual.status === "CANCELADO";
    if (r.count) await auditar(tx, null, tardia ? "maquininha_aprovacao_tardia" : "maquininha_pagamento_confirmado", "comanda", pg.comandaId,
      { pagamentoId, valorCentavos: pg.valorCentavos, pagoEm: pagoEm.toISOString(), origemData: atual.pagoEm ? "REGISTRO_EXISTENTE"
        : extra.gatewaySimulado ? "SIMULACAO" : extra.pagoEm ? "PROVEDOR" : "DATA_CONSULTA" });
    return { alterou: r.count > 0, tardia };
  });
  if (resultado.tardia) {
    avisarComanda(pg.comandaId);
    throw new ErroNegocio("A Stone confirmou uma cobrança após o cancelamento local. O recebimento foi registrado; a gerência precisa conferir se houve outra cobrança e conciliar a comanda.", 409, "maquininha_aprovacao_tardia");
  }
  return resultado.alterou;
}

/**
 * Confere na Pagar.me o pedido da maquininha e atualiza o pagamento (webhook ou botao "conferir").
 * Devolve true se o pedido era de uma comanda.
 */
export async function sincronizarPedido(pedidoId: string) {
  if (pedidoId.startsWith(PREFIXO_SIMULADO)) return true;
  if (ehHomologacao()) throw new ErroNegocio("Homologação não consulta pedidos reais da maquininha.", 409, "homologacao");
  let pg = await db.pagamentoComanda.findUnique({ where: { gatewayPedidoId: pedidoId } });
  const pedido = await buscarPedido(pedidoId);
  if (pedido.id !== pedidoId) throw new ErroNegocio("Pedido divergente no retorno da maquininha.", 409, "maquininha_divergente");
  if (pg && ((pedido.metadata?.pagamento_id && pedido.metadata.pagamento_id !== pg.id)
    || (pedido.metadata?.comanda_id && pedido.metadata.comanda_id !== pg.comandaId))) {
    throw new ErroNegocio("Pedido vinculado a outra cobrança/comanda.", 409, "maquininha_divergente");
  }
  if (!pg) {
    // Recupera POST aceito cuja resposta/vínculo local falhou, sem confiar no webhook bruto.
    const id = pedido.metadata?.pagamento_id;
    if (!id || !pedido.metadata?.comanda_id) return false;
    const candidato = await db.pagamentoComanda.findUnique({ where: { id }, include: { comanda: { select: { numero: true } } } });
    if (!candidato || candidato.comandaId !== pedido.metadata.comanda_id || pedido.code !== referenciaPOS(candidato.comanda.numero, id)) return false;
    if (candidato.gatewayPedidoId && candidato.gatewayPedidoId !== pedidoId) {
      throw new ErroNegocio("Outro pedido já está vinculado a esta cobrança. Confira os dois pedidos com a gerência.", 409, "maquininha_divergente");
    }
    if (!candidato.gatewayPedidoId && candidato.status !== "AGUARDANDO") return false;
    conferirValoresPOS(pedido, candidato.valorCentavos);
    const r = await db.pagamentoComanda.updateMany({ where: { id, gatewayPedidoId: null, status: "AGUARDANDO" }, data: { gatewayPedidoId: pedidoId } });
    pg = r.count ? candidato : await db.pagamentoComanda.findUniqueOrThrow({ where: { id } });
    if (!r.count && pg.gatewayPedidoId !== pedidoId) {
      throw new ErroNegocio("O vínculo da maquininha mudou durante a conferência.", 409, "maquininha_divergente");
    }
  }
  const { pago, cancelavel, recebido, estornado, charge } = conferirValoresPOS(pedido, pg.valorCentavos);
  const recebidoEm = ultimoInstantePOS((pedido.charges ?? []).filter(c => (c.paid_amount ?? 0) > 0).map(c => c.paid_at));
  if (estornado > 0) {
    const devolvidoEm = ultimoInstantePOS((pedido.charges ?? []).filter(c => (c.canceled_amount ?? 0) > 0).map(c => c.canceled_at));
    await conciliarEstornoPOS(pg.id, pg.comandaId, pedidoId, estornado, recebido, devolvidoEm ?? new Date(), recebidoEm);
    avisarComanda(pg.comandaId);
  } else if (pago) {
    if (await marcarPago(pg.id, { nsu: charge?.code ?? null, bandeira: charge?.metadata?.schemeName ?? charge?.metadata?.scheme_name ?? null, pagoEm: recebidoEm }, true)) avisarComanda(pg.comandaId);
    // Sempre fechar: pedido aberto continua ocupando a fila da maquininha (limite de 30).
    await fecharPedido(pedidoId, "paid").catch((e) => console.error("[maquininha] fechar pedido", e instanceof ErroPagarme ? e.status : "transporte"));
  } else if (cancelavel && pg.status === "AGUARDANDO" && (pedido.status === "canceled" || pedido.status === "failed")) {
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM comandas WHERE id = ${pg!.comandaId} FOR UPDATE`;
      const r = await tx.pagamentoComanda.updateMany({ where: { id: pg!.id, status: "AGUARDANDO" }, data: { status: "CANCELADO" } });
      if (r.count) await auditar(tx, null, "maquininha_pagamento_cancelado", "comanda", pg!.comandaId, { pagamentoId: pg!.id, pedidoId });
    });
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
  if (!BALCAO.includes(s.papel)) throw proibido();
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
    // Primeiro concilia eventual aprovação; fechar pedido não devolve dinheiro já recebido.
    await sincronizarPedido(pg.gatewayPedidoId);
    const antes = await db.pagamentoComanda.findUniqueOrThrow({ where: { id: pagamentoId } });
    if (antes.status === "PAGO") throw new ErroNegocio("Pagamento aprovado na maquininha: para devolver, use “Pedir estorno”.", 409, "usar_estorno");
    if (antes.status === "CANCELADO") return;
    await fecharPedido(pg.gatewayPedidoId, "canceled").catch(() => {
      throw new ErroNegocio("A maquininha não confirmou o cancelamento. Confira antes de cobrar novamente.", 502, "maquininha_incerta");
    });
    await sincronizarPedido(pg.gatewayPedidoId);
    const depois = await db.pagamentoComanda.findUniqueOrThrow({ where: { id: pagamentoId } });
    if (depois.status !== "CANCELADO") throw new ErroNegocio("Cancelamento ainda não confirmado. Confira a maquininha antes de cobrar novamente.", 409, "maquininha_incerta");
    return;
  }
  if (pg.status === "AGUARDANDO" && !pg.gatewayPedidoId) throw new ErroNegocio("O envio à maquininha está em conferência. Verifique o pedido com a gerência antes de cancelar ou cobrar novamente.", 409, "maquininha_incerta");
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM comandas WHERE id = ${pg.comandaId} FOR UPDATE`;
    const atualizado = await tx.pagamentoComanda.updateMany({ where: { id: pagamentoId, status: pg.status, estornadoCentavos: pg.estornadoCentavos }, data: { status: "CANCELADO" } });
    if (!atualizado.count) throw new ErroNegocio("O pagamento mudou durante o cancelamento. Confira novamente.", 409, "pagamento_alterado");
    await auditar(tx, s.usuarioId, "cancelar_pagamento", "comanda", pg.comandaId, { pagamentoId, estava: pg.status, valorCentavos: pg.valorCentavos });
  });
  avisarComanda(pg.comandaId);
}

/** So no modo simulado: faz de conta que o cliente passou o cartao. */
export async function simularAprovacao(pagamentoId: string) {
  if (modoMaquininha() !== "simulada") throw new ErroNegocio("Simulação desligada.", 403, "proibido");
  const pg = await db.pagamentoComanda.findUnique({ where: { id: pagamentoId } });
  if (!pg) throw naoEncontrado("Pagamento");
  const gatewaySimulado = `${PREFIXO_SIMULADO}${pg.id}`;
  if (pg.gatewayPedidoId !== gatewaySimulado || pg.antecipadoId || pg.linkPagamentoId) {
    throw new ErroNegocio("Esse pagamento não pertence ao simulador da maquininha. Não é permitido simular uma cobrança real ou sem identificação.", 409, "simulacao_pagamento");
  }
  if (await marcarPago(pg.id, { nsu: String(Date.now()).slice(-6), bandeira: pg.forma === "PIX" ? "Pix" : "Visa", gatewaySimulado })) avisarComanda(pg.comandaId);
}
