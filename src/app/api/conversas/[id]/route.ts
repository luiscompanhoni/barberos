import { NextResponse } from "next/server";
import { z } from "zod";
import { BALCAO, exigirSessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { ErroNegocio, naoEncontrado, rota } from "@/lib/erros";
import { publicar } from "@/lib/eventos";
import { corpo } from "@/lib/validacao";
import { comPreferenciaDaConversa } from "@/lib/whatsapp/conversas";
import { auditar } from "@/lib/auditoria";
import { exigirOrigemAutenticacao } from "@/lib/auth/http-cliente";
import { dentroJanelaInstagram, instagramEmSimulacao } from "@/lib/instagram/canal";

/** Mensagens da conversa (e marca como lida). */
export const GET = rota(async (_req: Request, ctx: RouteContext<"/api/conversas/[id]">) => {
  await exigirSessao(BALCAO);
  const { id } = await ctx.params;
  const c = await db.conversa.findUnique({
    where: { id },
    select: {
      id: true, telefone: true, nomePerfil: true, estado: true, conviteApp: true, recusaAutomaticas: true, ultimaEntradaEm: true, instagramIgsid: true, atualizadoEm: true,
      cliente: { select: { id: true, nome: true, aceitaMensagens: true } },
      instagramCliente: { select: { nome: true } },
      mensagens: { orderBy: { criadoEm: "asc" }, take: 300, select: { id: true, autor: true, texto: true, erro: true, entregueEm: true, lidaEm: true, criadoEm: true } },
    },
  });
  if (!c) throw naoEncontrado("Conversa");
  const { instagramIgsid, instagramCliente, atualizadoEm, ...dados } = c;
  await db.conversa.updateMany({ where: { id, ...(instagramIgsid ? { atualizadoEm } : {}) }, data: { naoLidas: 0 } });
  return NextResponse.json(instagramIgsid ? {
    ...dados, canal: "INSTAGRAM", telefone: null, cliente: null, nomeVinculado: instagramCliente?.nome ?? null, referenciaDirect: instagramIgsid.slice(-6),
    janelaAberta: dentroJanelaInstagram(c.ultimaEntradaEm), simulado: instagramEmSimulacao(),
  } : { ...dados, canal: "WHATSAPP" });
});

/** Assumir a conversa (equipe responde) ou devolver para o bot. */
export const PATCH = rota(async (req: Request, ctx: RouteContext<"/api/conversas/[id]">) => {
  const s = await exigirSessao(BALCAO);
  const { id } = await ctx.params;
  const { estado } = await corpo(req, z.object({ estado: z.enum(["BOT", "HUMANO"]) }));
  await comPreferenciaDaConversa(id, async tx => {
    const atual = await tx.conversa.findUniqueOrThrow({ where: { id }, select: { instagramIgsid: true, estado: true, recusaAutomaticas: true } });
    if (atual.instagramIgsid) {
      exigirOrigemAutenticacao(req);
      if (atual.estado === estado) return;
      if (estado === "BOT" && atual.recusaAutomaticas) throw new ErroNegocio("O contato pediu para parar de receber respostas automáticas pelo Direct.");
      await auditar(tx, s.usuarioId, "instagram_responsavel", "conversa", id, { antes: atual.estado, depois: estado });
    }
    // Ao devolver para o bot, ele comeca uma sessao nova (nao viu o que a equipe falou).
    await tx.conversa.update({ where: { id }, data: { estado, ...(estado === "BOT" ? { sessao: [] } : {}), ...(atual.instagramIgsid ? { sessaoInicioEm: new Date() } : {}) } });
    await tx.mensagem.create({
      data: { conversaId: id, autor: "NOTA", texto: estado === "HUMANO" ? `${s.nome} assumiu a conversa.` : `${s.nome} devolveu a conversa para o bot.` },
    });
  });
  publicar({ tipo: "conversa", conversaId: id });
  return NextResponse.json({ ok: true });
});
