import { z } from "zod";
import { rota } from "@/lib/erros";
import { equipe, json, resposta } from "@/lib/estudio/http";
import { zRevisao } from "@/lib/estudio/regras";
import { enfileirar } from "@/lib/estudio/servico";
export const POST = rota(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const s = await equipe(req);
  const { revisao } = await json(req, z.object({ revisao: zRevisao }));
  return resposta({ id: await enfileirar(s.usuarioId, (await ctx.params).id, revisao) }, 202);
});
