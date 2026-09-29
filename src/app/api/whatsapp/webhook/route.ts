import { after, NextResponse } from "next/server";
import { receberMensagem } from "@/lib/bot/processar";
import { assinaturaValida, lerMensagens, telefoneCanonico } from "@/lib/whatsapp/webhook";

export const dynamic = "force-dynamic";

/** Verificacao do webhook pela Meta (feita uma vez, ao cadastrar a URL). */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const token = process.env.WHATSAPP_VERIFY_TOKEN;
  if (token && q.get("hub.mode") === "subscribe" && q.get("hub.verify_token") === token) {
    return new Response(q.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

/**
 * Mensagens dos clientes. Responde 200 na hora (a Meta reenvia se demorar) e
 * processa depois com `after`.
 */
export async function POST(req: Request) {
  const bruto = await req.text();
  const segredo = process.env.WHATSAPP_APP_SECRET;
  if (!segredo) {
    console.error("[whatsapp] WHATSAPP_APP_SECRET não configurado: webhook recusado.");
    return new Response("Não configurado", { status: 500 });
  }
  if (!assinaturaValida(bruto, req.headers.get("x-hub-signature-256"), segredo)) {
    return new Response("Assinatura inválida", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(bruto);
  } catch {
    return new Response("JSON inválido", { status: 400 });
  }

  const mensagens = lerMensagens(payload);
  after(async () => {
    for (const m of mensagens) {
      try {
        await receberMensagem({
          telefone: telefoneCanonico(m.waId),
          waId: m.waId,
          nomePerfil: m.nomePerfil,
          texto: m.texto,
          wamid: m.wamid,
        });
      } catch (e) {
        console.error("[whatsapp] falha ao processar mensagem", m.wamid, e);
      }
    }
  });
  return NextResponse.json({ ok: true });
}
