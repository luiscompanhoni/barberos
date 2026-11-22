import { exigirOrigemAutenticacao } from "@/lib/auth/http-cliente";
import { exigirSessao, GESTAO } from "@/lib/auth/sessao";
import { rota } from "@/lib/erros";
import { iniciarConviteApp } from "@/lib/whatsapp/convite-app";

export const POST = rota(async (req: Request, ctx: RouteContext<"/api/conversas/[id]/convite-app">) => {
  const s = await exigirSessao(GESTAO);
  exigirOrigemAutenticacao(req);
  const { segmento } = await iniciarConviteApp((await ctx.params).id, s.usuarioId, true);
  return Response.json({ ok: true, segmento });
});
