import { timingSafeEqual } from "node:crypto";
import { after, NextResponse } from "next/server";
import { processarWebhookEntrada, registrarWebhookPagamento } from "@/lib/pagamentos/webhook-entrada";
import { quarentenaRestauracao } from "@/lib/recuperacao/quarentena";

export const dynamic = "force-dynamic";

function tokenValido(recebido: string | null, esperado: string) {
  if (!recebido) return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Webhook do Asaas. Persiste a entrada antes de responder e processa depois.
 * O status real e buscado na API do Asaas (o corpo
 * recebido so diz qual cobranca olhar).
 */
export async function POST(req: Request) {
  const esperado = process.env.ASAAS_WEBHOOK_TOKEN;
  if (!esperado) return new Response("Webhook de pagamentos nao configurado", { status: 500 });
  if (!tokenValido(req.headers.get("asaas-access-token"), esperado)) return new Response("Token invalido", { status: 401 });
  if (quarentenaRestauracao()) return new Response("Recuperação em andamento.", { status: 503 });

  const corpo = (await req.json().catch(() => null)) as { id?: string; event?: string; payment?: { id?: string } } | null;
  const evento = corpo?.id;
  const tipo = corpo?.event;
  const cobranca = corpo?.payment?.id;
  if (evento && tipo?.startsWith("PAYMENT_") && cobranca) {
    let entrada: string;
    try { entrada = await registrarWebhookPagamento({ fonte: "asaas", evento, tipo, cobranca }); }
    catch { return new Response("Não foi possível registrar o webhook.", { status: 503 }); }
    after(async () => {
      await processarWebhookEntrada(entrada).catch(() => console.error("[pagamentos] falha ao tratar webhook registrado"));
    });
  }
  return NextResponse.json({ received: true });
}
