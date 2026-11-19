import { exigirOrigemAutenticacao } from "@/lib/auth/http-cliente";
import { exigirSessao, GESTAO } from "@/lib/auth/sessao";
import { rota } from "@/lib/erros";
import { iniciarConviteApp } from "@/lib/whatsapp/convite-app";

export const POST = rota(async (req: Request, ctx: RouteContext<"/api/conversas/[id]/convite-app">) => {
  const s = await exigirSessao(GESTAO);
  exigirOrigemAutenticacao(req);
  await iniciarConviteApp((await ctx.params).id, s.usuarioId);
  return Response.json({ ok: true });
});
