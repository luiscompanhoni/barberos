import { timingSafeEqual } from "node:crypto";
import { after, NextResponse } from "next/server";
import { processarEventoGateway } from "@/lib/assinaturas/cobrancas";

export const dynamic = "force-dynamic";

function tokenValido(recebido: string | null, esperado: string) {
  if (!recebido) return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Webhook do Asaas. Confere o token do cabecalho `asaas-access-token`, responde
 * na hora e processa depois. O status real e buscado na API do Asaas (o corpo
 * recebido so diz qual cobranca olhar).
 */
export async function POST(req: Request) {
  const esperado = process.env.ASAAS_WEBHOOK_TOKEN;
  if (!esperado) return new Response("Webhook de pagamentos nao configurado", { status: 500 });
  if (!tokenValido(req.headers.get("asaas-access-token"), esperado)) return new Response("Token invalido", { status: 401 });

  const corpo = (await req.json().catch(() => null)) as { id?: string; event?: string; payment?: { id?: string } } | null;
  const evento = corpo?.id;
  const tipo = corpo?.event;
  const cobranca = corpo?.payment?.id;
  if (evento && tipo?.startsWith("PAYMENT_") && cobranca) {
    after(async () => {
      try {
        await processarEventoGateway(evento, tipo, cobranca);
      } catch (e) {
        console.error("[pagamentos] falha ao processar evento", evento, e);
      }
    });
  }
  return NextResponse.json({ received: true });
}
