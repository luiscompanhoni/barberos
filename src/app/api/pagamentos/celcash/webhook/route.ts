import { timingSafeEqual } from "node:crypto";
import { randomUUID } from "node:crypto";
import { after, NextResponse } from "next/server";
import { processarWebhookEntrada, registrarWebhookPagamento } from "@/lib/pagamentos/webhook-entrada";
import { PREFIXO } from "@/lib/pagamentos/celcash";
import { quarentenaRestauracao } from "@/lib/recuperacao/quarentena";

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
 * salvar o webhook). Persiste os identificadores antes da resposta e busca o status real na API depois.
 */
export async function POST(req: Request) {
  const token = process.env.CELCASH_WEBHOOK_TOKEN;
  if (!token) return new Response("Webhook de pagamentos nao configurado", { status: 500 });
  if (!iguais(new URL(req.url).searchParams.get("token"), token)) return new Response("Token invalido", { status: 401 });
  if (quarentenaRestauracao()) return new Response("Recuperação em andamento.", { status: 503 });

  const corpo = (await req.json().catch(() => null)) as {
    event?: string; webhookId?: number; confirmHash?: string; Transaction?: { galaxPayId?: number };
  } | null;
  const hash = process.env.CELCASH_WEBHOOK_HASH;
  if (hash && !iguais(corpo?.confirmHash, hash)) return new Response("Hash invalido", { status: 401 });

  const transacao = corpo?.Transaction?.galaxPayId;
  if (corpo?.event === "transaction.updateStatus" && transacao) {
    const id = `${PREFIXO.transacao}${transacao}`;
    // O contrato desta rota não comprova que webhookId seja único por mudança
    // de status. Cada entrega é preservada e processada em série pela transação.
    const evento = `celcash:${transacao}:${randomUUID()}`;
    let entrada: string;
    try { entrada = await registrarWebhookPagamento({ fonte: "celcash", evento, tipo: corpo.event, cobranca: id }); }
    catch { return new Response("Não foi possível registrar o webhook.", { status: 503 }); }
    after(async () => {
      await processarWebhookEntrada(entrada).catch(() => console.error("[celcash] falha ao tratar webhook registrado"));
    });
  }
  return NextResponse.json({ ok: true });
}
