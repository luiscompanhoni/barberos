import { NextResponse } from "next/server";
import { exigirReunioes } from "@/lib/auth/permissoes";
import { rota } from "@/lib/erros";
import { corpo } from "@/lib/validacao";
import { editarAviso, editarAvisoSchema } from "@/lib/reunioes/avisos";

export const PATCH = rota(async (req: Request, ctx: RouteContext<"/api/reunioes/avisos/[id]">) => {
  const s = await exigirReunioes();
  return NextResponse.json(await editarAviso(s, (await ctx.params).id, await corpo(req, editarAvisoSchema)));
});
