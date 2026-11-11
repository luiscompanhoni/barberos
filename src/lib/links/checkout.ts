import { randomBytes } from "node:crypto";
import type { FormaPagamento } from "@prisma/client";
import { configuracao } from "@/lib/agenda/carregar";
import { dataLocal } from "@/lib/agenda/tempo";
import { cpfValido } from "@/lib/assinaturas/regras";
import { auditar } from "@/lib/auditoria";
import type { Sessao } from "@/lib/auth/sessao";
import { resumoComanda } from "@/lib/comandas/regras";
import { db } from "@/lib/db";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import { motivoLinkFechado, parcelasValidas, validadePixSeg } from "@/lib/pagamentos/checkout-regras";
import { gateway, gatewayPorId } from "@/lib/pagamentos/gateway";
import { exigirEmissaoDeCobranca } from "@/lib/pagamentos/bloqueio-cobranca";
import { estadoCheckoutLink } from "./estado";
import { marcarLinkPago, sincronizarLink } from "./sincronizacao";
import { encerramentoPendente, INCLUIR_CLIENTE, limparTentativa, travarLink } from "./transacao";
import { chaveEmConferencia, encerramentoDoLinkConfere, liquidacaoDoLinkConfere, valorDoLinkConfere } from "./valores";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export async function identificarLinkCheckout(token: string) {
  const l = await db.linkPagamento.findUnique({ where: { token }, select: { id: true } });
  if (!l) throw naoEncontrado("Link de pagamento");
  return l.id;
}

export async function porToken(token: string) {
  const l = await db.linkPagamento.findUnique({ where: { token }, include: INCLUIR_CLIENTE });
  if (!l) throw naoEncontrado("Link de pagamento");
  return l;
}

export async function pagarLink(token: string, p: { forma: Exclude<FormaPagamento, "BOLETO">; cartaoToken?: string; parcelas?: number; cpf?: string; email?: string }) {
  let l = await porToken(token);
  if (l.status === "PENDENTE" && l.gatewayId) {
    await sincronizarLink(l.id);
    l = await porToken(token);
  }
  const g = await gateway();
  if (!g.criarCobrancaAvulsa) throw new ErroNegocio("Pagamento online indisponível no momento. Fale com a barbearia.", 409, "indisponivel");
  const cfg = await configuracao();
  const reserva = await db.$transaction(async (tx) => {
    const atual = await travarLink(tx, l.id);
    // Repetição, troca de forma e timeout não geram uma segunda tentativa.
    if (atual.status === "PENDENTE" && (atual.gatewayId || atual.tentativaChave)) return { existente: true as const, link: atual };
    const fechado = motivoLinkFechado(atual);
    if (fechado) throw new ErroNegocio(fechado, 409, atual.status === "PAGO" ? "ja_pago" : "fechado");
    exigirEmissaoDeCobranca(g.nome);
    if (atual.comandaId) {
      const c = await tx.comanda.findUniqueOrThrow({ where: { id: atual.comandaId }, include: { itens: true, pagamentos: true } });
      if (c.status !== "ABERTA" || c.pagamentos.some((pg) => pg.status === "AGUARDANDO") || resumoComanda(c.itens, c.pagamentos, c.descontoCentavos).falta < atual.valorCentavos) {
        throw new ErroNegocio("A comanda mudou ou tem outra cobrança pendente. Fale com a barbearia antes de pagar.", 409, "comanda_alterada");
      }
    }
    if (p.forma === "CARTAO" && !p.cartaoToken) throw new ErroNegocio("Digite os dados do cartão.", 422, "cartao");
    const parcelas = p.forma === "CARTAO" ? parcelasValidas(p.parcelas, atual.parcelasMax) : 1;
    if (parcelas === null) throw new ErroNegocio(`Parcele em até ${atual.parcelasMax}x.`, 422, "parcelas");
    const cpf = (p.cpf ?? atual.cpf ?? atual.cliente?.cpf ?? "").replace(/\D/g, "");
    if (!cpfValido(cpf)) throw new ErroNegocio("Para pagar online precisamos de um CPF válido (exigência do meio de pagamento).", 422, "cpf");
    const email = (p.email ?? atual.email ?? atual.cliente?.email ?? "").trim().toLowerCase();
    if (g.exigeEmail && !EMAIL.test(email)) throw new ErroNegocio("Para pagar online precisamos do seu e-mail (exigência do meio de pagamento).", 422, "email");
    const tentativaChave = `lk-${atual.id}-${randomBytes(8).toString("hex")}`;
    const link = await tx.linkPagamento.update({ where: { id: atual.id }, data: { tentativaChave, forma: p.forma, parcelas: p.forma === "CARTAO" ? parcelas : null, cpf, email: email || null }, include: INCLUIR_CLIENTE });
    // O link pode ser encaminhado a outro pagador: ele não autoriza mudar o cadastro do cliente.
    await auditar(tx, null, "reservar_tentativa_link", "link_pagamento", atual.id, { tentativaChave, forma: p.forma, parcelas });
    return { existente: false as const, link, parcelas, cpf, email, tentativaChave };
  });
  if (reserva.existente) return estadoCheckoutLink(reserva.link);

  let cob;
  try {
    // A identidade externa desta tentativa não reutiliza o id do cadastro global da barbearia.
    const clienteGatewayId = await g.criarCliente({ nome: reserva.link.nome, cpf: reserva.cpf, telefone: reserva.link.telefone, email: reserva.email || null, referencia: reserva.tentativaChave });
    cob = await g.criarCobrancaAvulsa({
      clienteGatewayId, valorCentavos: reserva.link.valorCentavos, forma: p.forma, vencimento: dataLocal(reserva.link.expiraEm, cfg.fuso),
      descricao: `${reserva.link.descricao} - ${cfg.nomeBarbearia}`, referencia: reserva.tentativaChave,
      ...(p.forma === "CARTAO" ? { cartaoToken: p.cartaoToken, parcelas: reserva.parcelas } : { pixValidadeSeg: validadePixSeg(reserva.link.expiraEm) }),
    });
    if (!cob.id) throw Error("Retorno sem identificador");
  } catch {
    // A intenção continua gravada mesmo se a resposta se perder depois de o provedor cobrar.
    console.error("[links] criação sem confirmação", l.id);
    throw new ErroNegocio("Envio sem confirmação. Não tente outra cobrança; peça à barbearia para conferir o pagamento.", 502, "pagamento_incerto");
  }

  const recusado = p.forma === "CARTAO" && g.cartao === "token" && cob.status === "ATRASADA";
  const terminal = recusado || cob.status === "CANCELADA" || cob.status === "ESTORNADA";
  const { salvo, conferencia } = await db.$transaction(async (tx) => {
    const atual = await travarLink(tx, l.id);
    if (atual.status === "PAGO" && atual.gatewayId === cob.id) return { salvo: atual, conferencia: false };
    if (atual.tentativaChave !== reserva.tentativaChave || atual.status !== "PENDENTE" || (atual.gatewayId && atual.gatewayId !== cob.id)) throw new ErroNegocio("Pagamento em conferência. Aguarde a barbearia.", 409, "pagamento_incerto");
    const conferencia = !valorDoLinkConfere(cob, atual.valorCentavos)
      || (cob.status === "PAGA" && !liquidacaoDoLinkConfere(cob, atual.valorCentavos))
      || (terminal && !encerramentoDoLinkConfere(cob, atual.valorCentavos));
    const link = await tx.linkPagamento.update({ where: { id: l.id }, data: conferencia ? { gatewayId: cob.id, tentativaChave: chaveEmConferencia(atual.tentativaChave, l.id) } : terminal ? limparTentativa : {
      gatewayId: cob.id, pixCopiaECola: cob.pixCopiaECola ?? null, pixQrUrl: cob.pixQrUrl ?? null, pixExpiraEm: cob.expiraEm ? new Date(cob.expiraEm) : null,
    } });
    await auditar(tx, null, "pagar_link_pagamento", "link_pagamento", l.id, { tentativaChave: reserva.tentativaChave, forma: p.forma, parcelas: reserva.parcelas, retorno: cob.status, gatewayId: cob.id, conferencia });
    return { salvo: link, conferencia };
  });
  if (conferencia) throw new ErroNegocio("O provedor retornou valores de pagamento que precisam de conferência. Não faça outra cobrança; fale com a barbearia.", 409, "liquidacao_divergente");
  if (terminal) throw new ErroNegocio(recusado ? "O cartão não foi aceito. Confira os dados ou tente outro cartão." : "O provedor encerrou essa tentativa. Confira antes de tentar novamente.", 422, recusado ? "cartao_recusado" : "tentativa_encerrada");
  if (cob.status === "PAGA") {
    await marcarLinkPago(l.id, cob);
    return estadoCheckoutLink(await db.linkPagamento.findUniqueOrThrow({ where: { id: l.id } }));
  }
  return estadoCheckoutLink(salvo);
}

/** Cancelamento só libera o saldo após consulta autoritativa terminal do mesmo pedido. */
export async function cancelarLink(s: Sessao | null, id: string, motivo = "cancelado") {
  await sincronizarLink(id);
  const reservado = await db.$transaction(async (tx) => {
    const l = await travarLink(tx, id);
    if (l.status === "PAGO") throw new ErroNegocio("Esse link já foi pago: não dá para cancelar. Para devolver o dinheiro, use “Pedir estorno”.", 409, "ja_pago");
    if (l.status !== "PENDENTE") return { link: l, remoto: false };
    if (l.tentativaChave?.startsWith("conferir:")) throw new ErroNegocio("Os valores deste pagamento precisam de conferência. Não é seguro cancelar ou cobrar novamente automaticamente.", 409, "liquidacao_divergente");
    if (encerramentoPendente(l.tentativaChave)) throw new ErroNegocio("Cancelamento em conferência. Aguarde a confirmação do provedor.", 409, "cancelamento_pendente");
    if (l.tentativaChave && !l.gatewayId) throw new ErroNegocio("Envio sem confirmação. Não é seguro cancelar ou cobrar novamente antes de conferir com o provedor.", 409, "pagamento_incerto");
    const status = motivo === "expirado" ? "EXPIRADO" as const : "CANCELADO" as const;
    if (!l.gatewayId) {
      const link = await tx.linkPagamento.update({ where: { id }, data: { status } });
      await auditar(tx, s?.usuarioId ?? null, "cancelar_link_pagamento", "link_pagamento", id, { motivo });
      return { link, remoto: false };
    }
    const tentativaChave = `${status === "EXPIRADO" ? "expirar" : "cancelar"}:${id}:${randomBytes(8).toString("hex")}`;
    const link = await tx.linkPagamento.update({ where: { id }, data: { tentativaChave } });
    await auditar(tx, s?.usuarioId ?? null, "solicitar_cancelamento_link", "link_pagamento", id, { motivo, gatewayId: l.gatewayId });
    return { link, remoto: true };
  });
  if (!reservado.remoto) return reservado.link;
  const g = await gatewayPorId(reservado.link.gatewayId!);
  try {
    if (!g.cancelarCobrancaAvulsa || !g.buscarCobrancaAvulsa) throw Error("Consulta/cancelamento indisponível");
    await g.cancelarCobrancaAvulsa(reservado.link.gatewayId!);
  } catch {
    throw new ErroNegocio("O provedor não confirmou o cancelamento. A cobrança continua reservada para conferência.", 502, "cancelamento_incerto");
  }
  const atual = await sincronizarLink(id);
  if (atual?.status === "PAGO") throw new ErroNegocio("O pagamento foi confirmado antes do cancelamento. Para devolver, peça estorno.", 409, "ja_pago");
  if (!atual || atual.status === "PENDENTE") throw new ErroNegocio("Cancelamento em conferência. Não faça outra cobrança.", 409, "cancelamento_pendente");
  return atual;
}
