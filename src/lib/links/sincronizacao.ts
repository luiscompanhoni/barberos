import { auditar } from "@/lib/auditoria";
import { db } from "@/lib/db";
import { formaNaComanda } from "@/lib/pagamentos/checkout-regras";
import { gatewayPorId, type CobrancaAvulsa } from "@/lib/pagamentos/gateway";
import { notificarEmSegundoPlano } from "@/lib/whatsapp/conversas";
import { encerramentoPendente, limparTentativa, travarLink } from "./transacao";
import { chaveEmConferencia, encerramentoDoLinkConfere, liquidacaoDoLinkConfere, valorDoLinkConfere } from "./valores";

/** Consulta autoritativa; falha, ausência de adaptador ou atraso mantêm a reserva. */
export async function sincronizarLink(id: string) {
  const l = await db.linkPagamento.findUnique({ where: { id } });
  if (!l || l.status === "PAGO" || l.status === "ESTORNADO" || !l.gatewayId) return l;
  const g = await gatewayPorId(l.gatewayId);
  if (!g.buscarCobrancaAvulsa) return l;
  try {
    const c = await g.buscarCobrancaAvulsa(l.gatewayId);
    if (c.id !== l.gatewayId) return l;
    if (c.status === "PAGA") await marcarLinkPago(l.id, c);
    else await db.$transaction(async (tx) => {
      const atual = await travarLink(tx, l.id);
      if (atual.status !== "PENDENTE" || atual.gatewayId !== l.gatewayId || atual.tentativaChave !== l.tentativaChave) return;
      const terminal = c.status === "CANCELADA" || c.status === "ESTORNADA" || (c.status === "ATRASADA" && atual.forma === "CARTAO" && g.cartao === "token");
      if (!valorDoLinkConfere(c, atual.valorCentavos) || (terminal && !encerramentoDoLinkConfere(c, atual.valorCentavos))) {
        await tx.linkPagamento.update({ where: { id }, data: { tentativaChave: chaveEmConferencia(atual.tentativaChave, id) } });
        await auditar(tx, null, "conferir_valores_link", "link_pagamento", id, { gatewayId: c.id, retorno: c.status });
        return;
      }
      if (terminal) {
        const encerrar = encerramentoPendente(atual.tentativaChave);
        await tx.linkPagamento.update({ where: { id }, data: { ...limparTentativa, ...(encerrar ? { status: encerrar } : {}) } });
        await auditar(tx, null, encerrar ? "cancelar_link_pagamento" : "tentativa_link_encerrada", "link_pagamento", id, { gatewayId: l.gatewayId, retorno: c.status });
      } else if (c.pixCopiaECola && c.pixCopiaECola !== atual.pixCopiaECola) {
        await tx.linkPagamento.update({ where: { id }, data: { pixCopiaECola: c.pixCopiaECola, pixQrUrl: c.pixQrUrl ?? atual.pixQrUrl } });
      }
    });
  } catch {
    console.error("[links] consulta sem confirmação", l.id);
  }
  return db.linkPagamento.findUnique({ where: { id } });
}

/** Pago uma vez; usa a mesma ordem de travas das reservas e não sobrescreve outra tentativa. */
export async function marcarLinkPago(id: string, cobranca: CobrancaAvulsa) {
  const r = await db.$transaction(async (tx) => {
    const l = await travarLink(tx, id);
    const gatewayId = cobranca.id;
    if (l.status === "PAGO" || l.status === "ESTORNADO" || l.gatewayId !== gatewayId) return null;
    if (cobranca.status !== "PAGA" || !liquidacaoDoLinkConfere(cobranca, l.valorCentavos)) {
      await tx.linkPagamento.update({ where: { id }, data: { tentativaChave: chaveEmConferencia(l.tentativaChave, id) } });
      await auditar(tx, null, "conferir_valores_link", "link_pagamento", id, { gatewayId, retorno: cobranca.status });
      return null;
    }
    const data = cobranca.pagaEm ? new Date(cobranca.pagaEm) : new Date();
    const quando = Number.isNaN(data.getTime()) ? new Date() : data;
    await tx.linkPagamento.update({ where: { id }, data: { status: "PAGO", pagoEm: quando } });
    await auditar(tx, null, "link_pagamento_recebido", "link_pagamento", id, { valorCentavos: l.valorCentavos, forma: l.forma, gatewayId });
    let comandaId: string | null = null;
    if (l.comandaId && l.comanda?.status === "ABERTA" && !(await tx.pagamentoComanda.findUnique({ where: { linkPagamentoId: id } }))) {
      await tx.pagamentoComanda.create({ data: { comandaId: l.comandaId, linkPagamentoId: id, forma: formaNaComanda(l.forma), valorCentavos: l.valorCentavos, status: "PAGO", pagoEm: quando } });
      await auditar(tx, null, "pagamento", "comanda", l.comandaId, { forma: formaNaComanda(l.forma), valorCentavos: l.valorCentavos, linkPagamentoId: id });
      comandaId = l.comandaId;
    }
    return { l, comandaId };
  });
  if (!r) return;
  if (r.comandaId) (await import("@/lib/comandas/servico")).avisarComanda(r.comandaId);
  notificarEmSegundoPlano(r.l.telefone, `Oi, ${r.l.nome.split(" ")[0]}! Recebemos o pagamento de ${(r.l.valorCentavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} (${r.l.descricao}). Obrigado! 💈`);
}
