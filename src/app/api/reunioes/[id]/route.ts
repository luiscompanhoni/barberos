import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirReunioes } from "@/lib/auth/permissoes";
import { rota } from "@/lib/erros";
import { corpo, parametros } from "@/lib/validacao";
import { editarReuniaoSchema } from "@/lib/reunioes/schemas";
import { editarReuniao, lerReuniao } from "@/lib/reunioes/servico";

export const GET = rota(async (req: Request, ctx: RouteContext<"/api/reunioes/[id]">) => {
  const s = await exigirReunioes();
  const q = parametros(req, z.object({ apresentacao: z.enum(["equipe", "gestao"]).optional() }));
  return NextResponse.json(await lerReuniao(s, (await ctx.params).id, q.apresentacao === "equipe"));
});
export const PATCH = rota(async (req: Request, ctx: RouteContext<"/api/reunioes/[id]">) => {
  const s = await exigirReunioes();
  return NextResponse.json(await editarReuniao(s, (await ctx.params).id, await corpo(req, editarReuniaoSchema)));
});
