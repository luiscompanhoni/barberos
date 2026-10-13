import { timingSafeEqual } from "node:crypto";
import { after, NextResponse } from "next/server";
import { alvosDoWebhook, processarWebhookPagarme, type CorpoWebhookPagarme } from "@/lib/pagamentos/webhook-pagarme";

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
 * O corpo so indica o que mudou (mensalidade, maquininha, horario pago antes, link de
 * pagamento): o status real e buscado na API (ver lib/pagamentos/webhook-pagarme.ts).
 */
export async function POST(req: Request) {
  const esperado = process.env.PAGARME_WEBHOOK_TOKEN;
  if (!esperado) return new Response("Webhook de pagamentos nao configurado", { status: 500 });
  if (!iguais(new URL(req.url).searchParams.get("token"), esperado)) return new Response("Token invalido", { status: 401 });

  const alvos = alvosDoWebhook((await req.json().catch(() => null)) as CorpoWebhookPagarme);
  if (!alvos) return NextResponse.json({ ok: true });
  after(async () => {
    try {
      await processarWebhookPagarme(alvos);
    } catch (e) {
      console.error("[pagarme] falha ao processar webhook", alvos.evento, e);
    }
  });
  return NextResponse.json({ ok: true });
}
