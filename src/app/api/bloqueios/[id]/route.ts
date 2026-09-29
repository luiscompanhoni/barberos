import { NextResponse } from "next/server";
import { exigirSessao } from "@/lib/auth/sessao";
import { reabrirAgenda } from "@/lib/agenda/expediente";
import { rota } from "@/lib/erros";

/** Reabre um periodo fechado. */
export const DELETE = rota(async (_req: Request, ctx: RouteContext<"/api/bloqueios/[id]">) => {
  const s = await exigirSessao();
  const { id } = await ctx.params;
  await reabrirAgenda(id, s);
  return NextResponse.json({ ok: true });
});
