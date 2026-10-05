import { timingSafeEqual } from "node:crypto";
import { after, NextResponse } from "next/server";
import { processarEventoGateway } from "@/lib/assinaturas/cobrancas";
import { cancelar } from "@/lib/assinaturas/servico";
import { sincronizarPedido } from "@/lib/comandas/maquininha";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

function iguais(a: string | null, b: string) {
  if (!a) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Webhook da Pagar.me. Cadastre na dashboard a URL
 *   https://SEU-DOMINIO/api/pagamentos/pagarme/webhook?token=<PAGARME_WEBHOOK_TOKEN>
 * O corpo so indica qual cobranca mudou: o status real e buscado na API.
 */
export async function POST(req: Request) {
  const esperado = process.env.PAGARME_WEBHOOK_TOKEN;
  if (!esperado) return new Response("Webhook de pagamentos nao configurado", { status: 500 });
  if (!iguais(new URL(req.url).searchParams.get("token"), esperado)) return new Response("Token invalido", { status: 401 });

  const corpo = (await req.json().catch(() => null)) as {
    id?: string;
    type?: string;
    data?: { id?: string; charge?: { id?: string } | null; charges?: { id?: string }[]; order?: { id?: string } | null };
  } | null;
  const evento = corpo?.id;
  const tipo = corpo?.type ?? "";
  if (!evento || !corpo?.data) return NextResponse.json({ ok: true });

  // Cobranca: direto (charge.*), dentro da fatura (invoice.*) ou do pedido Pix (order.*).
  const cobrancas = tipo.startsWith("charge.")
    ? [corpo.data.id]
    : tipo.startsWith("invoice.")
      ? [corpo.data.charge?.id]
      : tipo.startsWith("order.")
        ? (corpo.data.charges ?? []).map((c) => c.id)
        : [];
  // Pedido da maquininha (Stone Connect): o proprio pedido (order.*) ou o pedido da cobranca (charge.*).
  const pedido = tipo.startsWith("order.") ? corpo.data.id : tipo.startsWith("charge.") ? corpo.data.order?.id : undefined;
  const assinaturaCancelada = tipo === "subscription.canceled" ? corpo.data.id : null;

  after(async () => {
    try {
      // Pagamento de comanda nao e mensalidade: trata e para aqui.
      if (pedido && (await sincronizarPedido(pedido))) return;
      for (const id of cobrancas.filter((x): x is string => !!x)) await processarEventoGateway(`${evento}:${id}`, tipo, id);
      if (assinaturaCancelada) {
        // Cancelada na Pagar.me (ex.: tentativas do cartao esgotadas): reflete aqui.
        const a = await db.assinatura.findUnique({ where: { gatewayId: assinaturaCancelada } });
        if (a && a.status !== "CANCELADA") await cancelar(a.id, "Cancelada no meio de pagamento", null);
      }
    } catch (e) {
      console.error("[pagarme] falha ao processar webhook", evento, e);
    }
  });
  return NextResponse.json({ ok: true });
}
