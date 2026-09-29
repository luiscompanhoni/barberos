import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirSessao } from "@/lib/auth/sessao";
import { receberMensagem } from "@/lib/bot/processar";
import { ErroNegocio, rota } from "@/lib/erros";
import { normalizarTelefone } from "@/lib/telefone";
import { provedorWhatsApp } from "@/lib/whatsapp/canal";
import { corpo } from "@/lib/validacao";
import { db } from "@/lib/db";

/**
 * Simula um cliente mandando mensagem no WhatsApp (so com WHATSAPP_PROVIDER=simulador).
 * Espera o bot responder antes de devolver.
 */
export const POST = rota(async (req: Request) => {
  await exigirSessao(["DONO"]);
  if (provedorWhatsApp() !== "simulador") throw new ErroNegocio("Simulador desligado: o WhatsApp real esta ativo.", 403);
  const b = await corpo(
    req,
    z.object({ telefone: z.string().max(30), nomePerfil: z.string().max(60).optional(), texto: z.string().trim().min(1).max(2000) }),
  );
  const telefone = normalizarTelefone(b.telefone);
  if (!telefone) throw new ErroNegocio("Telefone inválido.", 400);
  await receberMensagem({ telefone, nomePerfil: b.nomePerfil ?? null, texto: b.texto, wamid: `sim-${crypto.randomUUID()}` });
  return NextResponse.json({ ok: true });
});

async function conversaDoTelefone(req: Request) {
  await exigirSessao(["DONO"]);
  const tel = normalizarTelefone(new URL(req.url).searchParams.get("telefone") ?? "");
  if (!tel) throw new ErroNegocio("Telefone inválido.", 400);
  return tel;
}

/** Mensagens da conversa simulada. */
export const GET = rota(async (req: Request) => {
  const telefone = await conversaDoTelefone(req);
  const c = await db.conversa.findUnique({
    where: { telefone },
    select: {
      id: true, estado: true,
      mensagens: { orderBy: { criadoEm: "asc" }, select: { id: true, autor: true, texto: true, criadoEm: true } },
    },
  });
  return NextResponse.json(c ?? { id: null, estado: "BOT", mensagens: [] });
});

/** Recomeca a conversa simulada do zero (apaga mensagens e a sessao do bot). */
export const DELETE = rota(async (req: Request) => {
  const telefone = await conversaDoTelefone(req);
  if (provedorWhatsApp() !== "simulador") throw new ErroNegocio("Simulador desligado.", 403);
  await db.conversa.deleteMany({ where: { telefone } });
  return NextResponse.json({ ok: true });
});
