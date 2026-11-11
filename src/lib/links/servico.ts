/**
 * Links de pagamento: a equipe cria uma cobranca avulsa (ou de uma comanda aberta) e manda o
 * link /c/link/<token>. O cliente paga no checkout do BarberOS (Pix ou cartao tokenizado).
 * Pago: o link vira PAGO, o cliente recebe o aviso e, se tiver comanda aberta, o valor entra
 * nela como pagamento (PIX ou CREDITO ligado ao link).
 */
import type { LinkPagamento } from "@prisma/client";
import { configuracao } from "@/lib/agenda/carregar";
import { cpfValido } from "@/lib/assinaturas/regras";
import { linkAbsoluto, novoTokenPublico } from "@/lib/assinaturas/cobrancas";
import { auditar } from "@/lib/auditoria";
import type { Sessao } from "@/lib/auth/sessao";
import { resumoComanda } from "@/lib/comandas/regras";
import { db } from "@/lib/db";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import {
  erroNovoLink, motivoLinkFechado, situacaoLink, textoEnvioLink,
} from "@/lib/pagamentos/checkout-regras";
import { gateway } from "@/lib/pagamentos/gateway";
import { exigirEmissaoDeCobranca } from "@/lib/pagamentos/bloqueio-cobranca";
import { normalizarTelefone } from "@/lib/telefone";
import { notificarCliente } from "@/lib/whatsapp/conversas";

import { cancelarLink, porToken } from "./checkout";
import { estadoCheckoutLink } from "./estado";
import { sincronizarLink } from "./sincronizacao";
export { pagarLink, cancelarLink } from "./checkout";
export { estadoCheckoutLink } from "./estado";
export { sincronizarLink } from "./sincronizacao";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const caminhoLink = (token: string) => `/c/link/${token}`;

type ComCliente = LinkPagamento & { cliente?: { nome: string; cpf: string | null; email: string | null } | null; comanda?: { numero: number; status: string } | null };

/** Formato do painel. */
function paraPainel(l: ComCliente) {
  return {
    id: l.id, token: l.token, url: linkAbsoluto(caminhoLink(l.token))!, descricao: l.descricao, valorCentavos: l.valorCentavos,
    nome: l.nome, telefone: l.telefone, clienteId: l.clienteId, comandaId: l.comandaId, comandaNumero: l.comanda?.numero ?? null,
    status: l.status === "PENDENTE" && (l.tentativaChave || l.gatewayId) ? "PENDENTE" as const : situacaoLink(l), forma: l.forma, parcelas: l.parcelas, parcelasMax: l.parcelasMax,
    pagoEm: l.pagoEm, expiraEm: l.expiraEm, criadoEm: l.criadoEm,
  };
}
export type LinkPainel = ReturnType<typeof paraPainel>;

// ---------------------------------------------------------------- painel

export async function criarLink(s: Sessao, p: {
  clienteId?: string | null; nome?: string | null; telefone?: string | null; comandaId?: string | null;
  descricao: string; valorCentavos: number; validadeDias: number; parcelasMax: number; enviar?: boolean;
}) {
  exigirEmissaoDeCobranca();
  const l = await db.$transaction(async (tx) => {
    let clienteId = p.clienteId ?? null;
    let faltaComanda: number | null = null;
    let nomeComanda: string | null = null;
    if (p.comandaId) {
      // Mesma trava do POS: saldo e reservas precisam ser relidos após esperar o outro caixa.
      await tx.$queryRaw`SELECT 1 FROM comandas WHERE id = ${p.comandaId} FOR UPDATE`;
      const c = await tx.comanda.findUnique({
        where: { id: p.comandaId },
        include: { itens: true, pagamentos: true, linksPagamento: { where: { status: "PENDENTE" } } },
      });
      if (!c) throw naoEncontrado("Comanda");
      if (c.status !== "ABERTA") throw new ErroNegocio("Essa comanda já foi fechada.");
      if (c.pagamentos.some((pg) => pg.status === "AGUARDANDO")) {
        throw new ErroNegocio("Há uma cobrança na maquininha aguardando confirmação. Confira ou cancele antes de criar um link.", 409, "pagamento_pendente");
      }
      const emLinks = c.linksPagamento.filter((link) => (situacaoLink(link) === "PENDENTE" || !!link.gatewayId || !!link.tentativaChave)).reduce((total, link) => total + link.valorCentavos, 0);
      faltaComanda = resumoComanda(c.itens, c.pagamentos, c.descontoCentavos).falta - emLinks;
      clienteId = clienteId ?? c.clienteId;
      nomeComanda = c.nomeAvulso;
    }
    const erro = erroNovoLink({ valorCentavos: p.valorCentavos, validadeDias: p.validadeDias, parcelasMax: p.parcelasMax, faltaComanda });
    if (erro) throw new ErroNegocio(erro);
    const cliente = clienteId ? await tx.cliente.findUnique({ where: { id: clienteId } }) : null;
    if (clienteId && !cliente) throw naoEncontrado("Cliente");
    const nome = (cliente?.nome || p.nome || nomeComanda || "").trim();
    const telefone = cliente?.telefone ?? normalizarTelefone(p.telefone ?? "");
    if (nome.length < 2) throw new ErroNegocio("Informe o nome de quem vai pagar.");
    if (!telefone) throw new ErroNegocio("Informe um celular válido (com DDD) para enviar o link.");
    const descricao = p.descricao.trim();
    if (descricao.length < 2) throw new ErroNegocio("Descreva o que está sendo cobrado.");
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

/** Comanda fechada ou cancelada: os links dela em aberto deixam de valer. */
export async function cancelarLinksDaComanda(comandaId: string) {
  const abertos = await db.linkPagamento.findMany({ where: { comandaId, status: "PENDENTE" }, select: { id: true } });
  for (const l of abertos) await cancelarLink(null, l.id, "comanda_encerrada").catch((e) => console.error("[links] comanda encerrada", l.id, e));
}

// ---------------------------------------------------------------- pagina publica

/** Dados da pagina publica + estado do checkout (`conferir`: consulta o gateway se estiver em aberto). */
export async function linkPublico(token: string, conferir = true) {
  let l = await porToken(token);
  if (conferir && l.status === "PENDENTE" && l.gatewayId) {
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

/** Rotina: confere os links em aberto e expira os vencidos. */
export async function sincronizarLinksPendentes() {
  const pendentes = await db.linkPagamento.findMany({ where: { status: "PENDENTE" }, select: { id: true, gatewayId: true, expiraEm: true } });
  let expirados = 0;
  for (const p of pendentes) {
    const l = p.gatewayId ? await sincronizarLink(p.id) : await db.linkPagamento.findUnique({ where: { id: p.id } });
    if (l?.status === "PENDENTE" && l.expiraEm.getTime() <= Date.now()) {
      const encerrado = await cancelarLink(null, l.id, "expirado").catch(() => null);
      if (encerrado?.status === "EXPIRADO") expirados++;
    }
  }
  return { conferidos: pendentes.length, expirados };
}
