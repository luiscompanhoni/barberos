import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirSessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { ErroNegocio, naoEncontrado, rota } from "@/lib/erros";
import { provedorWhatsApp } from "@/lib/whatsapp/canal";
import { enviarNaConversa } from "@/lib/whatsapp/conversas";
import { corpo } from "@/lib/validacao";

/** Resposta da equipe. Assume a conversa (o bot para de responder). */
export const POST = rota(async (req: Request, ctx: RouteContext<"/api/conversas/[id]/mensagens">) => {
  await exigirSessao(["DONO", "RECEPCAO"]);
  const { id } = await ctx.params;
  const { texto } = await corpo(req, z.object({ texto: z.string().trim().min(1).max(4000) }));
  const c = await db.conversa.findUnique({ where: { id } });
  if (!c) throw naoEncontrado("Conversa");
  const janelaAberta = !!c.ultimaEntradaEm && Date.now() - c.ultimaEntradaEm.getTime() < 24 * 3_600_000;
  if (!janelaAberta && provedorWhatsApp() === "cloud") {
    throw new ErroNegocio("O cliente não escreve há mais de 24h: o WhatsApp só permite mensagem livre depois que ele mandar algo.", 422);
  }
  if (c.estado !== "HUMANO") await db.conversa.update({ where: { id }, data: { estado: "HUMANO" } });
  const r = await enviarNaConversa(id, texto, "EQUIPE");
  if (!r.ok) throw new ErroNegocio(`Não foi possível enviar: ${r.erro}`, 502);
  return NextResponse.json({ ok: true }, { status: 201 });
});
