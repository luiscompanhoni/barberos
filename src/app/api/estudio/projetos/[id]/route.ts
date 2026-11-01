import { z } from "zod";
import { db } from "@/lib/db";
import { rota } from "@/lib/erros";
import { equipe, json, resposta } from "@/lib/estudio/http";
import { zEdicao, zRevisao } from "@/lib/estudio/regras";
import { editar, excluirProjeto, projeto, publico } from "@/lib/estudio/servico";
type Contexto = { params: Promise<{ id: string }> };
export const GET = rota(async (req: Request, ctx: Contexto) => {
  const s = await equipe(req);
  return resposta(publico(await projeto(db, s.usuarioId, (await ctx.params).id)));
});
export const PATCH = rota(async (req: Request, ctx: Contexto) => {
  const s = await equipe(req);
  await editar(s.usuarioId, (await ctx.params).id, await json(req, zEdicao));
  return resposta({ ok: true });
});
export const DELETE = rota(async (req: Request, ctx: Contexto) => {
  const s = await equipe(req);
  await excluirProjeto(s.usuarioId, (await ctx.params).id, (await json(req, z.object({ revisao: zRevisao }))).revisao);
  return resposta({ ok: true });
});
