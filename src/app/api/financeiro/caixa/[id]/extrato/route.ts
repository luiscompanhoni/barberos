import { NextResponse } from "next/server";
import { exigirSessao } from "@/lib/auth/sessao";
import { rota } from "@/lib/erros";
import { extratoCaixa } from "@/lib/financeiro/extrato";

export const dynamic = "force-dynamic";

/** Extrato (movimentacao linha a linha) de um caixa, aberto ou fechado. */
export const GET = rota(async (_req: Request, ctx: RouteContext<"/api/financeiro/caixa/[id]/extrato">) => {
  await exigirSessao(["DONO", "RECEPCAO"]);
  const { id } = await ctx.params;
  return NextResponse.json(await extratoCaixa(id));
});
