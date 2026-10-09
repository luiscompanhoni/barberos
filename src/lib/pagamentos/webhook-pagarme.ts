/**
 * Webhook da Pagar.me: o corpo so indica o que mudou (cobranca, pedido ou assinatura);
 * o status real sempre e buscado na API antes de mudar qualquer coisa.
 */
import { processarEventoGateway } from "@/lib/assinaturas/cobrancas";
import { cancelar } from "@/lib/assinaturas/servico";
import { sincronizarPedido } from "@/lib/comandas/maquininha";
import { db } from "@/lib/db";
import { sincronizarPedidoOnline } from "./checkout";

export type CorpoWebhookPagarme = {
  id?: string;
  type?: string;
  data?: { id?: string; charge?: { id?: string } | null; charges?: { id?: string }[]; order?: { id?: string } | null };
} | null;

/** O que o evento manda olhar (regra pura). */
export function alvosDoWebhook(corpo: CorpoWebhookPagarme) {
  const evento = corpo?.id;
  const tipo = corpo?.type ?? "";
  if (!evento || !corpo?.data) return null;
  // Cobranca: direto (charge.*), dentro da fatura (invoice.*) ou do pedido (order.*).
  const cobrancas = (tipo.startsWith("charge.")
    ? [corpo.data.id]
    : tipo.startsWith("invoice.")
      ? [corpo.data.charge?.id]
      : tipo.startsWith("order.")
        ? (corpo.data.charges ?? []).map((c) => c.id)
        : []
  ).filter((x): x is string => !!x);
  // Pedido: o proprio pedido (order.*) ou o pedido da cobranca (charge.*).
  const pedido = (tipo.startsWith("order.") ? corpo.data.id : tipo.startsWith("charge.") ? corpo.data.order?.id : undefined) ?? null;
  const assinaturaCancelada = tipo === "subscription.canceled" ? (corpo.data.id ?? null) : null;
  return { evento, tipo, cobrancas, pedido, assinaturaCancelada };
}

/** Processa o evento (chamado depois de responder a Pagar.me). */
export async function processarWebhookPagarme(alvos: NonNullable<ReturnType<typeof alvosDoWebhook>>) {
  const { evento, tipo, cobrancas, pedido, assinaturaCancelada } = alvos;
  // Comanda na maquininha, horario pago antes ou link de pagamento: nao e mensalidade.
  if (pedido && ((await sincronizarPedido(pedido)) || (await sincronizarPedidoOnline(pedido)))) return;
  for (const id of cobrancas) await processarEventoGateway(`${evento}:${id}`, tipo, id);
  if (assinaturaCancelada) {
    // Cancelada na Pagar.me (ex.: tentativas do cartao esgotadas): reflete aqui.
    const a = await db.assinatura.findUnique({ where: { gatewayId: assinaturaCancelada } });
    if (a && a.status !== "CANCELADA") await cancelar(a.id, "Cancelada no meio de pagamento", null);
  }
}
