import { exigirOrigemAutenticacao } from "@/lib/auth/http-cliente";
import { exigirSessao, GESTAO } from "@/lib/auth/sessao";
import { ErroNegocio, naoEncontrado, rota } from "@/lib/erros";
import { db } from "@/lib/db";
import { iniciarConviteApp } from "@/lib/whatsapp/convite-app";

export const POST = rota(async (req: Request, ctx: RouteContext<"/api/conversas/[id]/convite-app">) => {
  const s = await exigirSessao(GESTAO);
  exigirOrigemAutenticacao(req);
  const { id } = await ctx.params;
  const conversa = await db.conversa.findUnique({ where: { id }, select: { instagramIgsid: true } });
  if (!conversa) throw naoEncontrado("Conversa");
  if (conversa.instagramIgsid) throw new ErroNegocio("Convites do Leonel estão disponíveis apenas em conversas de WhatsApp.");
  const { segmento } = await iniciarConviteApp(id, s.usuarioId, true);
  return Response.json({ ok: true, segmento });
});
