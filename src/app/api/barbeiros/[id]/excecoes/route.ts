import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirSessao } from "@/lib/auth/sessao";
import { removerExcecao, salvarExcecao } from "@/lib/agenda/expediente";
import { rota } from "@/lib/erros";
import { corpo, parametros, zData, zIntervaloMin } from "@/lib/validacao";

/** Folga, dia extra ou horario diferente numa data. */
export const POST = rota(async (req: Request, ctx: RouteContext<"/api/barbeiros/[id]/excecoes">) => {
  const s = await exigirSessao();
  const { id } = await ctx.params;
  const b = await corpo(
    req,
    z.object({
      data: zData,
      tipo: z.enum(["FOLGA", "HORARIO_ESPECIAL"]),
      intervalos: z.array(zIntervaloMin).max(4).optional(),
      motivo: z.string().trim().max(120).optional(),
    }),
  );
  return NextResponse.json(await salvarExcecao(id, b, s));
});

export const DELETE = rota(async (req: Request, ctx: RouteContext<"/api/barbeiros/[id]/excecoes">) => {
  const s = await exigirSessao();
  const { id } = await ctx.params;
  const { data } = parametros(req, z.object({ data: zData }));
  return NextResponse.json(await removerExcecao(id, data, s));
});
