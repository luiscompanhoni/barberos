import { rota } from "@/lib/erros";
import { equipe, json, resposta } from "@/lib/estudio/http";
import { zClipe } from "@/lib/estudio/regras";
import { reservar } from "@/lib/estudio/servico";
export const POST = rota(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const s = await equipe(req);
  const clipe = await reservar(s.usuarioId, (await ctx.params).id, await json(req, zClipe));
  return resposta({ id: clipe.id }, 201);
});
