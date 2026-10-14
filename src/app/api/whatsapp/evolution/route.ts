import { timingSafeEqual } from "node:crypto";
import { after, NextResponse } from "next/server";
import { receberMensagem } from "@/lib/bot/processar";
import { provedorWhatsApp } from "@/lib/whatsapp/canal";
import { tokenWebhookEvolution } from "@/lib/whatsapp/evolution";
import { registrarStatus } from "@/lib/whatsapp/status";
import { lerMensagensEvolution, lerStatusEvolution, telefoneCanonico } from "@/lib/whatsapp/webhook";

export const dynamic = "force-dynamic";

function tokenValido(recebido: string | null) {
  const a = Buffer.from(recebido ?? "");
  const b = Buffer.from(tokenWebhookEvolution());
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Mensagens e status (entregue/lida) do WhatsApp nao oficial (Evolution API). Responde na hora e processa depois. */
export async function POST(req: Request) {
  if (provedorWhatsApp() !== "evolution") return new Response("Desligado", { status: 404 });
  if (!tokenValido(req.headers.get("x-barberos-token"))) return new Response("Não autorizado", { status: 401 });

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return new Response("JSON inválido", { status: 400 });
  }

  const mensagens = lerMensagensEvolution(payload);
  const status = lerStatusEvolution(payload);
  after(async () => {
    await registrarStatus(status).catch((e) => console.error("[whatsapp] falha ao gravar status", e));
    for (const m of mensagens) {
      try {
        await receberMensagem({ telefone: telefoneCanonico(m.waId), waId: m.waId, nomePerfil: m.nomePerfil, texto: m.texto, wamid: m.wamid });
      } catch (e) {
        console.error("[whatsapp] falha ao processar mensagem", m.wamid, e);
      }
    }
  });
  return NextResponse.json({ ok: true });
}
