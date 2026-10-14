import { NextResponse } from "next/server";
import { z } from "zod";
import { BALCAO, exigirSessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { naoEncontrado, rota } from "@/lib/erros";
import { publicar } from "@/lib/eventos";
import { corpo } from "@/lib/validacao";

/** Mensagens da conversa (e marca como lida). */
export const GET = rota(async (_req: Request, ctx: RouteContext<"/api/conversas/[id]">) => {
  await exigirSessao(BALCAO);
  const { id } = await ctx.params;
  const c = await db.conversa.findUnique({
    where: { id },
    select: {
      id: true, telefone: true, nomePerfil: true, estado: true, ultimaEntradaEm: true,
      cliente: { select: { id: true, nome: true } },
      mensagens: { orderBy: { criadoEm: "asc" }, take: 300, select: { id: true, autor: true, texto: true, erro: true, criadoEm: true } },
    },
  });
  if (!c) throw naoEncontrado("Conversa");
  await db.conversa.update({ where: { id }, data: { naoLidas: 0 } });
  return NextResponse.json(c);
});

/** Assumir a conversa (equipe responde) ou devolver para o bot. */
export const PATCH = rota(async (req: Request, ctx: RouteContext<"/api/conversas/[id]">) => {
  const s = await exigirSessao(BALCAO);
  const { id } = await ctx.params;
  const { estado } = await corpo(req, z.object({ estado: z.enum(["BOT", "HUMANO"]) }));
  await db.$transaction([
    // Ao devolver para o bot, ele comeca uma sessao nova (nao viu o que a equipe falou).
    db.conversa.update({ where: { id }, data: { estado, ...(estado === "BOT" ? { sessao: [] } : {}) } }),
    db.mensagem.create({
      data: { conversaId: id, autor: "NOTA", texto: estado === "HUMANO" ? `${s.nome} assumiu a conversa.` : `${s.nome} devolveu a conversa para o bot.` },
    }),
  ]);
  publicar({ tipo: "conversa", conversaId: id });
  return NextResponse.json({ ok: true });
});
