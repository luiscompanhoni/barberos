import { NextResponse } from "next/server";
import { exigirSessao } from "@/lib/auth/sessao";
import { consultarIdentidadeAvaliacao } from "@/lib/avaliacoes/respostas";
import { rota } from "@/lib/erros";

export const GET = rota(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const s = await exigirSessao(["DONO"]);
  const { id } = await ctx.params;
  return NextResponse.json(await consultarIdentidadeAvaliacao(s, id), { headers: { "Cache-Control": "private, no-store" } });
});
