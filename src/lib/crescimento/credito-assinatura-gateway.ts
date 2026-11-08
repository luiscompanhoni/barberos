import type { Assinatura, Cobranca, ReservaCreditoAssinatura } from "@prisma/client";
import { aplicarCreditoFixo, consultarParaCredito } from "@/lib/pagamentos/retencao-gateway";
import { conferirSnapshotRemoto, diaCredito, lista, registro, revisaoCredito, type ProvaCobrancaCredito } from "./credito-assinatura-regras";

export async function conferirGatewayAntesDoCredito(a: Assinatura, descontoId?: string, valor?: number) {
  const [assinatura, faturas] = await Promise.all([
    consultarParaCredito(`/subscriptions/${encodeURIComponent(a.gatewayId!)}`),
    consultarParaCredito(`/invoices?subscription_id=${encodeURIComponent(a.gatewayId!)}&size=100`),
  ]);
  return conferirSnapshotRemoto(a, assinatura, faturas, descontoId, valor);
}

/** O POST acontece uma única vez; erro ou retorno sem prova deixa a reserva em revisão. */
export async function aplicarNoGateway(a: Assinatura, r: ReservaCreditoAssinatura) {
  await conferirGatewayAntesDoCredito(a);
  const desconto = registro(await aplicarCreditoFixo(a.gatewayId!, r.valorCentavos, r.id));
  if (typeof desconto.id !== "string" || !desconto.id.startsWith("dis_")) throw revisaoCredito();
  const prova = registro(await consultarParaCredito(`/subscriptions/${encodeURIComponent(a.gatewayId!)}/discounts/${encodeURIComponent(desconto.id)}`));
  if (prova.id !== desconto.id || prova.value !== r.valorCentavos || prova.discount_type !== "flat" || prova.cycles !== 1 || prova.status !== "active") throw revisaoCredito();
  await conferirGatewayAntesDoCredito(a, desconto.id, r.valorCentavos);
  return desconto.id;
}

/** Leitura própria para hooks que não têm moeda/prova completa no CobrancaGateway. */
export async function buscarProvaCobrancaCredito(a: Assinatura, c: Cobranca, r: ReservaCreditoAssinatura): Promise<ProvaCobrancaCredito> {
  if (!c.gatewayId.startsWith("ch_")) throw revisaoCredito();
  const cob = registro(await consultarParaCredito(`/charges/${encodeURIComponent(c.gatewayId)}`));
  if (cob.id !== c.gatewayId || cob.currency !== "BRL" || !Number.isSafeInteger(cob.amount)) throw revisaoCredito();
  if (!["paid", "pending", "processing"].includes(String(cob.status))) throw revisaoCredito();
  const pagamento = cob.status === "paid"
    ? { status: "PAGA" as const, pagoEm: typeof cob.paid_at === "string" ? cob.paid_at : null, liquidadoCentavos: Number.isSafeInteger(cob.paid_amount) && Number.isSafeInteger(cob.canceled_amount) ? Number(cob.paid_amount) - Number(cob.canceled_amount) : undefined }
    : { status: "PENDENTE" as const, pagoEm: null };
  if (a.gatewayId?.startsWith("pixrec_")) {
    const ordemId = registro(cob.order).id;
    if (typeof ordemId !== "string") throw revisaoCredito();
    const ordem = registro(await consultarParaCredito(`/orders/${encodeURIComponent(ordemId)}`));
    const metadata = registro(ordem.metadata), cliente = registro(ordem.customer);
    if (ordem.id !== ordemId || ordem.currency !== "BRL" || ordem.amount !== cob.amount || metadata.assinatura_gateway_id !== a.gatewayId || metadata.vencimento !== diaCredito(r.vencimento)) throw revisaoCredito();
    return { id: String(cob.id), assinaturaGatewayId: a.gatewayId, clienteGatewayId: String(cliente.id), valorCentavos: Number(cob.amount), vencimento: String(metadata.vencimento), moeda: "BRL", ...pagamento };
  }
  const faturaId = registro(cob.invoice).id;
  if (typeof faturaId !== "string" || !r.gatewayDescontoId) throw revisaoCredito();
  const f = registro(await consultarParaCredito(`/invoices/${encodeURIComponent(faturaId)}`));
  const assinaturaId = f.subscription_id ?? registro(f.subscription).id;
  const d = registro(await consultarParaCredito(`/subscriptions/${encodeURIComponent(a.gatewayId!)}/discounts/${encodeURIComponent(r.gatewayDescontoId)}`));
  if (f.id !== faturaId || registro(f.charge).id !== cob.id || f.currency !== "BRL" || f.amount !== cob.amount || typeof f.due_at !== "string" || d.id !== r.gatewayDescontoId || d.value !== r.valorCentavos || d.discount_type !== "flat" || d.cycles !== 1) throw revisaoCredito();
  if (!lista(f.discounts).some((x) => { const desconto = registro(x); return desconto.id === r.gatewayDescontoId && desconto.value === r.valorCentavos && desconto.discount_type === "flat"; })) throw revisaoCredito();
  return { id: String(cob.id), assinaturaGatewayId: String(assinaturaId), clienteGatewayId: String(registro(f.customer).id), valorCentavos: Number(cob.amount), vencimento: f.due_at.slice(0, 10), moeda: "BRL", descontoId: r.gatewayDescontoId, ...pagamento };
}
