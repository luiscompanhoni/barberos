import { NextResponse } from "next/server";
import { z } from "zod";
import { BALCAO, exigirSessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { ErroNegocio, naoEncontrado, rota } from "@/lib/erros";
import { temJanela24h } from "@/lib/whatsapp/canal";
import { comPreferenciaDaConversa, enviarNaConversa } from "@/lib/whatsapp/conversas";
import { corpo } from "@/lib/validacao";
import { exigirOrigemAutenticacao } from "@/lib/auth/http-cliente";
import { enviarRespostaEquipeInstagram } from "@/lib/instagram/persistencia";

/** Resposta da equipe. Assume a conversa (o bot para de responder). */
export const POST = rota(async (req: Request, ctx: RouteContext<"/api/conversas/[id]/mensagens">) => {
  const s = await exigirSessao(BALCAO);
  const { id } = await ctx.params;
  const { texto, envioId } = await corpo(req, z.object({ texto: z.string().trim().min(1).max(4000), envioId: z.uuid().optional() }));
  const c = await db.conversa.findUnique({ where: { id } });
  if (!c) throw naoEncontrado("Conversa");
  if (c.instagramIgsid) {
    exigirOrigemAutenticacao(req);
    if (!envioId) throw new ErroNegocio("Identificador de envio obrigatório para o Direct.", 400);
    const resultado = await enviarRespostaEquipeInstagram(id, texto, s.usuarioId, envioId);
    if (!resultado?.ok) throw new ErroNegocio(resultado?.erro ?? "O envio foi interrompido.", 502);
    return NextResponse.json({ ok: true, simulado: resultado.simulado }, { status: 201 });
  }
  const janelaAberta = !!c.ultimaEntradaEm && Date.now() - c.ultimaEntradaEm.getTime() < 24 * 3_600_000;
  if (!janelaAberta && temJanela24h()) {
    throw new ErroNegocio("O cliente não escreve há mais de 24h: o WhatsApp só permite mensagem livre depois que ele mandar algo.", 422);
  }
  if (c.estado !== "HUMANO") await comPreferenciaDaConversa(id, tx => tx.conversa.update({ where: { id }, data: { estado: "HUMANO" } }));
  const r = await enviarNaConversa(id, texto, "EQUIPE");
  if (!r.ok) throw new ErroNegocio(`Não foi possível enviar: ${r.erro}`, 502);
  return NextResponse.json({ ok: true }, { status: 201 });
});
