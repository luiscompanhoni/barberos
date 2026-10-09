/**
 * Links de pagamento: a equipe cria uma cobranca avulsa (ou de uma comanda aberta) e manda o
 * link /c/link/<token>. O cliente paga no checkout do BarberOS (Pix ou cartao tokenizado).
 * Pago: o link vira PAGO, o cliente recebe o aviso e, se tiver comanda aberta, o valor entra
 * nela como pagamento (PIX ou CREDITO ligado ao link).
 */
import type { FormaPagamento, LinkPagamento, Prisma } from "@prisma/client";
import { configuracao } from "@/lib/agenda/carregar";
import { dataLocal } from "@/lib/agenda/tempo";
import { cpfValido } from "@/lib/assinaturas/regras";
import { linkAbsoluto, novoTokenPublico } from "@/lib/assinaturas/cobrancas";
import { auditar } from "@/lib/auditoria";
import type { Sessao } from "@/lib/auth/sessao";
import { resumoComanda } from "@/lib/comandas/regras";
import { db } from "@/lib/db";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import {
  erroNovoLink, formaNaComanda, motivoLinkFechado, parcelasValidas, pixVencido, situacaoLink, textoEnvioLink, validadePixSeg,
  type EstadoCheckout,
} from "@/lib/pagamentos/checkout-regras";
import { gateway, gatewayPorId } from "@/lib/pagamentos/gateway";
import { normalizarTelefone } from "@/lib/telefone";
import { notificarCliente, notificarEmSegundoPlano } from "@/lib/whatsapp/conversas";

const reais = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const caminhoLink = (token: string) => `/c/link/${token}`;

type ComCliente = LinkPagamento & { cliente?: { nome: string; cpf: string | null; email: string | null } | null; comanda?: { numero: number; status: string } | null };

/** Formato do painel. */
function paraPainel(l: ComCliente) {
  return {
    id: l.id, token: l.token, url: linkAbsoluto(caminhoLink(l.token))!, descricao: l.descricao, valorCentavos: l.valorCentavos,
    nome: l.nome, telefone: l.telefone, clienteId: l.clienteId, comandaId: l.comandaId, comandaNumero: l.comanda?.numero ?? null,
    status: situacaoLink(l), forma: l.forma, parcelas: l.parcelas, parcelasMax: l.parcelasMax,
    pagoEm: l.pagoEm, expiraEm: l.expiraEm, criadoEm: l.criadoEm,
  };
}
export type LinkPainel = ReturnType<typeof paraPainel>;

/** Estado para a tela do checkout. */
export function estadoCheckoutLink(l: LinkPagamento): EstadoCheckout {
  const status = situacaoLink(l);
  const aberto = status === "PENDENTE";
  const pix = aberto && l.forma === "PIX" && l.pixCopiaECola
    ? { copiaECola: l.pixCopiaECola, qrUrl: l.pixQrUrl, expiraEm: l.pixExpiraEm?.toISOString() ?? null }
    : null;
  // Simulado: pagina de teste para "pagar" o Pix.
  const teste = aberto && l.forma === "PIX" && l.gatewayId?.startsWith("sim") ? linkAbsoluto(`/c/pagamento-simulado/${l.gatewayId}`) : null;
  return { status, forma: l.forma === "BOLETO" ? null : l.forma, pix, link: teste, processando: aberto && l.forma === "CARTAO" && !!l.gatewayId };
}

// ---------------------------------------------------------------- painel

export async function criarLink(s: Sessao, p: {
  clienteId?: string | null; nome?: string | null; telefone?: string | null; comandaId?: string | null;
  descricao: string; valorCentavos: number; validadeDias: number; parcelasMax: number; enviar?: boolean;
}) {
  let clienteId = p.clienteId ?? null;
  let faltaComanda: number | null = null;
  let nomeComanda: string | null = null;
  if (p.comandaId) {
    const c = await db.comanda.findUnique({
      where: { id: p.comandaId },
      include: { itens: true, pagamentos: true, linksPagamento: { where: { status: "PENDENTE" } } },
    });
    if (!c) throw naoEncontrado("Comanda");
    if (c.status !== "ABERTA") throw new ErroNegocio("Essa comanda já foi fechada.");
    // Desconta os links que ainda estao em aberto (nao cobra duas vezes o mesmo valor).
    const emLinks = c.linksPagamento.filter((l) => situacaoLink(l) === "PENDENTE").reduce((t, l) => t + l.valorCentavos, 0);
    faltaComanda = resumoComanda(c.itens, c.pagamentos, c.descontoCentavos).falta - emLinks;
    clienteId = clienteId ?? c.clienteId;
    nomeComanda = c.nomeAvulso;
  }
  const erro = erroNovoLink({ valorCentavos: p.valorCentavos, validadeDias: p.validadeDias, parcelasMax: p.parcelasMax, faltaComanda });
  if (erro) throw new ErroNegocio(erro);

  const cliente = clienteId ? await db.cliente.findUnique({ where: { id: clienteId } }) : null;
  if (clienteId && !cliente) throw naoEncontrado("Cliente");
  const nome = (cliente?.nome || p.nome || nomeComanda || "").trim();
  const telefone = cliente?.telefone ?? normalizarTelefone(p.telefone ?? "");
  if (nome.length < 2) throw new ErroNegocio("Informe o nome de quem vai pagar.");
  if (!telefone) throw new ErroNegocio("Informe um celular válido (com DDD) para enviar o link.");
  const descricao = p.descricao.trim();
  if (descricao.length < 2) throw new ErroNegocio("Descreva o que está sendo cobrado.");

  const l = await db.$transaction(async (tx) => {
    const novo = await tx.linkPagamento.create({
      data: {
        token: novoTokenPublico(), descricao, valorCentavos: p.valorCentavos, clienteId: cliente?.id ?? null, nome, telefone,
        comandaId: p.comandaId ?? null, parcelasMax: p.parcelasMax, expiraEm: new Date(Date.now() + p.validadeDias * 86_400_000), criadoPorId: s.usuarioId,
      },
      include: { comanda: { select: { numero: true, status: true } } },
    });
    await auditar(tx, s.usuarioId, "criar_link_pagamento", "link_pagamento", novo.id, { valorCentavos: p.valorCentavos, comandaId: p.comandaId ?? null });
    return novo;
  });
  const envio = p.enviar ? await enviarLink(s, l.id) : null;
  return { link: paraPainel(l), envio };
}

export async function listarLinks(f: { comandaId?: string } = {}) {
  const lista = await db.linkPagamento.findMany({
    where: f.comandaId ? { comandaId: f.comandaId } : { OR: [{ status: "PENDENTE" }, { criadoEm: { gte: new Date(Date.now() - 60 * 86_400_000) } }] },
    orderBy: { criadoEm: "desc" },
    take: 200,
    include: { comanda: { select: { numero: true, status: true } } },
  });
  return lista.map(paraPainel);
}

/** Manda o link no WhatsApp do cliente (espera o resultado para mostrar no painel). */
export async function enviarLink(s: Sessao | null, id: string) {
  const l = await db.linkPagamento.findUnique({ where: { id } });
  if (!l) throw naoEncontrado("Link");
  const motivo = motivoLinkFechado(l);
  if (motivo) throw new ErroNegocio(motivo, 409, "fechado");
  const cfg = await configuracao();
  const r = await notificarCliente(l.telefone, textoEnvioLink({
    nome: l.nome, descricao: l.descricao, valorCentavos: l.valorCentavos, url: linkAbsoluto(caminhoLink(l.token))!,
    expiraEm: l.expiraEm, barbearia: cfg.nomeBarbearia, fuso: cfg.fuso,
  }));
  await auditar(db, s?.usuarioId ?? null, "enviar_link_pagamento", "link_pagamento", id, { ok: r.ok });
  return { ok: r.ok, erro: r.erro };
}

/** Cancela um link em aberto (confere antes: pode ter acabado de ser pago). */
export async function cancelarLink(s: Sessao | null, id: string, motivo = "cancelado") {
  let l = await sincronizarLink(id);
  if (!l) throw naoEncontrado("Link");
  if (l.status === "PAGO") throw new ErroNegocio("Esse link já foi pago: não dá para cancelar. Se precisar devolver, faça o estorno no painel da Pagar.me.", 409, "ja_pago");
  if (l.status !== "PENDENTE") return l;
  if (l.gatewayId) await (await gatewayPorId(l.gatewayId)).cancelarCobrancaAvulsa?.(l.gatewayId).catch((e) => console.error("[links] cancelar no gateway", l?.gatewayId, e));
  const status = motivo === "expirado" ? ("EXPIRADO" as const) : ("CANCELADO" as const);
  await db.$transaction(async (tx) => {
    await tx.linkPagamento.updateMany({ where: { id, status: "PENDENTE" }, data: { status } });
    await auditar(tx, s?.usuarioId ?? null, "cancelar_link_pagamento", "link_pagamento", id, { motivo });
  });
  l = await db.linkPagamento.findUniqueOrThrow({ where: { id } });
  return l;
}

/** Comanda fechada ou cancelada: os links dela em aberto deixam de valer. */
export async function cancelarLinksDaComanda(comandaId: string) {
  const abertos = await db.linkPagamento.findMany({ where: { comandaId, status: "PENDENTE" }, select: { id: true } });
  for (const l of abertos) await cancelarLink(null, l.id, "comanda_encerrada").catch((e) => console.error("[links] comanda encerrada", l.id, e));
}

// ---------------------------------------------------------------- pagina publica

async function porToken(token: string) {
  const l = await db.linkPagamento.findUnique({
    where: { token },
    include: { cliente: { select: { nome: true, cpf: true, email: true } }, comanda: { select: { numero: true, status: true } } },
  });
  if (!l) throw naoEncontrado("Link de pagamento");
  return l;
}

/** Dados da pagina publica + estado do checkout (`conferir`: consulta o gateway se estiver em aberto). */
export async function linkPublico(token: string, conferir = true) {
  let l = await porToken(token);
  if (conferir && l.status !== "PAGO" && l.gatewayId) {
    await sincronizarLink(l.id);
    l = await porToken(token);
  }
  const g = await gateway();
  const cpf = l.cpf ?? l.cliente?.cpf ?? null;
  const email = l.email ?? l.cliente?.email ?? null;
  return {
    link: {
      descricao: l.descricao, valorCentavos: l.valorCentavos, nome: l.nome, parcelasMax: l.parcelasMax, expiraEm: l.expiraEm,
      comandaNumero: l.comanda?.numero ?? null, pagoEm: l.pagoEm,
      pedir: { cpf: !cpfValido(cpf ?? ""), email: g.exigeEmail && !EMAIL.test(email ?? "") },
    },
    checkout: estadoCheckoutLink(l),
  };
}

/** O cliente escolheu pagar: gera o Pix ou cobra o cartao (token) na hora. */
export async function pagarLink(token: string, p: { forma: Exclude<FormaPagamento, "BOLETO">; cartaoToken?: string; parcelas?: number; cpf?: string; email?: string }) {
  let l = await porToken(token);
  if (l.status === "PENDENTE" && l.gatewayId) {
    await sincronizarLink(l.id);
    l = await porToken(token);
  }
  const fechado = motivoLinkFechado(l);
  if (fechado) throw new ErroNegocio(fechado, 409, l.status === "PAGO" ? "ja_pago" : "fechado");
  if (l.comanda && l.comanda.status !== "ABERTA") throw new ErroNegocio("Essa comanda já foi fechada na barbearia.", 409, "fechado");

  const g = await gateway();
  if (!g.criarCobrancaAvulsa) throw new ErroNegocio("Pagamento online indisponível no momento. Fale com a barbearia.", 409, "indisponivel");
  if (p.forma === "CARTAO" && !p.cartaoToken) throw new ErroNegocio("Digite os dados do cartão.", 422, "cartao");
  const parcelas = p.forma === "CARTAO" ? parcelasValidas(p.parcelas, l.parcelasMax) : 1;
  if (parcelas === null) throw new ErroNegocio(`Parcele em até ${l.parcelasMax}x.`, 422, "parcelas");

  // Mesmo Pix ainda valendo: reaproveita (o cliente recarregou a pagina).
  if (p.forma === "PIX" && l.forma === "PIX" && l.gatewayId && l.pixCopiaECola && !pixVencido(l.pixExpiraEm)) return estadoCheckoutLink(l);

  const cpf = (p.cpf ?? l.cpf ?? l.cliente?.cpf ?? "").replace(/\D/g, "");
  if (!cpfValido(cpf)) throw new ErroNegocio("Para pagar online precisamos de um CPF válido (exigência do meio de pagamento).", 422, "cpf");
  const email = (p.email ?? l.email ?? l.cliente?.email ?? "").trim().toLowerCase();
  if (g.exigeEmail && !EMAIL.test(email)) throw new ErroNegocio("Para pagar online precisamos do seu e-mail (exigência do meio de pagamento).", 422, "email");
  if (l.clienteId && l.cliente && (cpf !== l.cliente.cpf || (email && email !== l.cliente.email))) {
    await db.cliente.update({ where: { id: l.clienteId }, data: { cpf, ...(email ? { email } : {}) } });
  }

  // Tentativa anterior em aberto (outro Pix, Pix vencido): cancela antes de gerar outra.
  if (l.gatewayId) await (await gatewayPorId(l.gatewayId)).cancelarCobrancaAvulsa?.(l.gatewayId).catch(() => {});
  const cfg = await configuracao();
  let cob;
  try {
    const clienteGatewayId = await g.criarCliente({
      nome: l.cliente?.nome || l.nome, cpf, telefone: l.telefone, email: email || null, referencia: l.clienteId ?? `link-${l.id}`,
    });
    cob = await g.criarCobrancaAvulsa({
      clienteGatewayId, valorCentavos: l.valorCentavos, forma: p.forma, vencimento: dataLocal(l.expiraEm, cfg.fuso),
      descricao: `${l.descricao} - ${cfg.nomeBarbearia}`, referencia: `lk-${l.id}-${Date.now().toString(36)}`,
      ...(p.forma === "CARTAO" ? { cartaoToken: p.cartaoToken, parcelas } : { pixValidadeSeg: validadePixSeg(l.expiraEm) }),
    });
  } catch (e) {
    console.error("[links] falha no gateway:", e);
    await db.linkPagamento.update({ where: { id: l.id }, data: { gatewayId: null, forma: null, pixCopiaECola: null, pixQrUrl: null, pixExpiraEm: null } });
    if (p.forma === "CARTAO") throw new ErroNegocio("O cartão não foi aceito. Confira os dados ou tente outro cartão.", 422, "cartao_recusado");
    throw new ErroNegocio("Não foi possível gerar o pagamento agora. Tente de novo em instantes.", 502, "gateway");
  }

  const recusado = p.forma === "CARTAO" && (cob.status === "ATRASADA" || cob.status === "CANCELADA");
  const salvo = await db.linkPagamento.update({
    where: { id: l.id },
    data: recusado
      ? { forma: null, gatewayId: null, pixCopiaECola: null, pixQrUrl: null, pixExpiraEm: null, cpf, email: email || null }
      : {
          forma: p.forma, gatewayId: cob.id, parcelas: p.forma === "CARTAO" ? parcelas : null, cpf, email: email || null,
          pixCopiaECola: cob.pixCopiaECola ?? null, pixQrUrl: cob.pixQrUrl ?? null, pixExpiraEm: cob.expiraEm ? new Date(cob.expiraEm) : null,
        },
  });
  await auditar(db, null, "pagar_link_pagamento", "link_pagamento", l.id, { forma: p.forma, parcelas, recusado, gatewayId: cob.id });
  if (recusado) throw new ErroNegocio(cob.erro ?? "O cartão não foi aceito. Confira os dados ou tente outro cartão.", 422, "cartao_recusado");
  if (cob.status === "PAGA") {
    await marcarLinkPago(l.id, cob.pagaEm);
    return estadoCheckoutLink(await db.linkPagamento.findUniqueOrThrow({ where: { id: l.id } }));
  }
  return estadoCheckoutLink(salvo);
}

// ---------------------------------------------------------------- confirmacao

/** Consulta o gateway (webhook, pagina, rotina). Pagamento que chega atrasado ainda conta. */
export async function sincronizarLink(id: string) {
  const l = await db.linkPagamento.findUnique({ where: { id } });
  if (!l || l.status === "PAGO" || !l.gatewayId) return l;
  const g = await gatewayPorId(l.gatewayId);
  if (!g.buscarCobrancaAvulsa) return l;
  try {
    const c = await g.buscarCobrancaAvulsa(l.gatewayId);
    if (c.status === "PAGA") await marcarLinkPago(l.id, c.pagaEm);
    else if (l.status === "PENDENTE" && (c.status === "CANCELADA" || c.status === "ESTORNADA" || (c.status === "ATRASADA" && g.cartao === "token"))) {
      // A tentativa morreu (Pix cancelado, cartao recusado na analise): o link segue aberto para tentar de novo.
      await db.linkPagamento.updateMany({ where: { id, status: "PENDENTE", gatewayId: l.gatewayId }, data: { gatewayId: null, forma: null, pixCopiaECola: null, pixQrUrl: null, pixExpiraEm: null } });
    } else if (c.pixCopiaECola && c.pixCopiaECola !== l.pixCopiaECola) {
      await db.linkPagamento.update({ where: { id }, data: { pixCopiaECola: c.pixCopiaECola, pixQrUrl: c.pixQrUrl ?? l.pixQrUrl } });
    }
  } catch (e) {
    console.error(`[links] falha ao consultar ${l.gatewayId}:`, e);
  }
  return db.linkPagamento.findUnique({ where: { id } });
}

type Tx = Prisma.TransactionClient;

/** Pago: marca uma vez, lanca na comanda aberta e avisa o cliente. */
async function marcarLinkPago(id: string, pagoEm: string | null) {
  const r = await db.$transaction(async (tx: Tx) => {
    const quando = pagoEm ? new Date(pagoEm) : new Date();
    const ok = await tx.linkPagamento.updateMany({ where: { id, status: { not: "PAGO" } }, data: { status: "PAGO", pagoEm: quando } });
    if (!ok.count) return null;
    const l = await tx.linkPagamento.findUniqueOrThrow({ where: { id } });
    await auditar(tx, null, "link_pagamento_recebido", "link_pagamento", id, { valorCentavos: l.valorCentavos, forma: l.forma });
    let comandaId: string | null = null;
    if (l.comandaId) {
      await tx.$queryRaw`SELECT 1 FROM comandas WHERE id = ${l.comandaId} FOR UPDATE`;
      const c = await tx.comanda.findUnique({ where: { id: l.comandaId }, select: { status: true } });
      if (c?.status === "ABERTA" && !(await tx.pagamentoComanda.findUnique({ where: { linkPagamentoId: id } }))) {
        await tx.pagamentoComanda.create({
          data: { comandaId: l.comandaId, linkPagamentoId: id, forma: formaNaComanda(l.forma), valorCentavos: l.valorCentavos, status: "PAGO", pagoEm: quando },
        });
        await auditar(tx, null, "pagamento", "comanda", l.comandaId, { forma: formaNaComanda(l.forma), valorCentavos: l.valorCentavos, linkPagamentoId: id });
        comandaId = l.comandaId;
      }
    }
    return { l, comandaId };
  });
  if (!r) return;
  if (r.comandaId) (await import("@/lib/comandas/servico")).avisarComanda(r.comandaId);
  notificarEmSegundoPlano(
    r.l.telefone,
    `Oi, ${r.l.nome.split(" ")[0]}! Recebemos o pagamento de ${reais(r.l.valorCentavos)} (${r.l.descricao}). Obrigado! 💈`,
  );
}

/** Rotina: confere os links em aberto e expira os vencidos. */
export async function sincronizarLinksPendentes() {
  const pendentes = await db.linkPagamento.findMany({ where: { status: "PENDENTE" }, select: { id: true, gatewayId: true, expiraEm: true } });
  let expirados = 0;
  for (const p of pendentes) {
    const l = p.gatewayId ? await sincronizarLink(p.id) : await db.linkPagamento.findUnique({ where: { id: p.id } });
    if (l?.status === "PENDENTE" && l.expiraEm.getTime() <= Date.now()) {
      await cancelarLink(null, l.id, "expirado").catch((e) => console.error("[links] expirar", l.id, e));
      expirados++;
    }
  }
  return { conferidos: pendentes.length, expirados };
}
