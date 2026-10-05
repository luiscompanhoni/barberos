import { NextResponse } from "next/server";
import { exigirSessao } from "@/lib/auth/sessao";
import { configuracao } from "@/lib/agenda/carregar";
import { proibido, rota } from "@/lib/erros";
import { indicadoresDoBarbeiro } from "@/lib/indicadores/barbeiro";
import { resolverPeriodo } from "@/lib/indicadores/periodo";

/** Detalhe de um barbeiro: o dono ve todos; o barbeiro, so o dele. */
export const GET = rota(async (req: Request, ctx: RouteContext<"/api/indicadores/barbeiro/[id]">) => {
  const s = await exigirSessao(["DONO", "BARBEIRO"]);
  const { id } = await ctx.params;
  if (s.papel === "BARBEIRO" && s.barbeiroId !== id) throw proibido();
  const cfg = await configuracao();
  const p = resolverPeriodo(new URL(req.url).searchParams.get("periodo"), cfg.fuso);
  return NextResponse.json({ periodo: { chave: p.chave, rotulo: p.rotulo }, ...(await indicadoresDoBarbeiro(id, p)) });
});
