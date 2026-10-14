import { NextResponse } from "next/server";
import { exigirSessao, GESTAO } from "@/lib/auth/sessao";
import { funilCampanha } from "@/lib/campanhas/funil";
import { rota } from "@/lib/erros";

export const dynamic = "force-dynamic";

/** Funil da campanha: enviadas → entregues → lidas → abriram → (giraram → ganharam) → app → conta → agendaram → vieram. */
export const GET = rota(async (_req: Request, ctx: RouteContext<"/api/campanhas/[id]/funil">) => {
  await exigirSessao(GESTAO);
  const { id } = await ctx.params;
  return NextResponse.json(await funilCampanha(id));
});
