import { NextResponse } from "next/server";
import { BALCAO, exigirSessao } from "@/lib/auth/sessao";
import { rota } from "@/lib/erros";
import { entregarBrinde } from "@/lib/roleta/servico";

/** Marca o brinde da roleta como entregue no balcao. */
export const POST = rota(async (_req: Request, ctx: RouteContext<"/api/roleta/giros/[id]">) => {
  const s = await exigirSessao(BALCAO);
  const { id } = await ctx.params;
  await entregarBrinde(s, id);
  return NextResponse.json({ ok: true });
});
