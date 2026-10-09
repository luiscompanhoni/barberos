import { timingSafeEqual } from "node:crypto";
import { after, NextResponse } from "next/server";
import { processarEventoGateway } from "@/lib/assinaturas/cobrancas";
import { PREFIXO } from "@/lib/pagamentos/celcash";

export const dynamic = "force-dynamic";

function iguais(a: string | null | undefined, b: string) {
  if (!a) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Webhook da Celcash (evento transaction.updateStatus). Cadastre na Celcash a URL
 *   https://SEU-DOMINIO/api/pagamentos/celcash/webhook?token=<CELCASH_WEBHOOK_TOKEN>
 * Confere o token da URL e o confirmHash (CELCASH_WEBHOOK_HASH, mostrado pela Celcash ao
 * salvar o webhook). Responde na hora (limite de 5s) e busca o status real na API.
 */
export async function POST(req: Request) {
  const token = process.env.CELCASH_WEBHOOK_TOKEN;
  if (!token) return new Response("Webhook de pagamentos nao configurado", { status: 500 });
  if (!iguais(new URL(req.url).searchParams.get("token"), token)) return new Response("Token invalido", { status: 401 });

  const corpo = (await req.json().catch(() => null)) as {
    event?: string; webhookId?: number; confirmHash?: string; Transaction?: { galaxPayId?: number };
  } | null;
  const hash = process.env.CELCASH_WEBHOOK_HASH;
  if (hash && !iguais(corpo?.confirmHash, hash)) return new Response("Hash invalido", { status: 401 });

  const transacao = corpo?.Transaction?.galaxPayId;
  if (corpo?.event === "transaction.updateStatus" && transacao) {
    const id = `${PREFIXO.transacao}${transacao}`;
    after(async () => {
      try {
        await processarEventoGateway(`celcash:${corpo.webhookId ?? Date.now()}:${transacao}`, corpo.event!, id);
      } catch (e) {
        console.error("[celcash] falha ao processar webhook", corpo.webhookId, e);
      }
    });
  }
  return NextResponse.json({ ok: true });
}
