import { NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/auth/permissoes";
import { exigirSessao } from "@/lib/auth/sessao";
import { configuracao } from "@/lib/agenda/carregar";
import { rota } from "@/lib/erros";
import { indicadoresDoBarbeiro } from "@/lib/indicadores/barbeiro";
import { resolverPeriodo } from "@/lib/indicadores/periodo";

/** Detalhe de um barbeiro: o barbeiro ve o dele; quem pode ver o resultado ve todos. */
export const GET = rota(async (req: Request, ctx: RouteContext<"/api/indicadores/barbeiro/[id]">) => {
  const s = await exigirSessao();
  const { id } = await ctx.params;
  if (!(s.barbeiroId === id)) await exigirPermissao(s, "resultado");
  const cfg = await configuracao();
  const p = resolverPeriodo(new URL(req.url).searchParams.get("periodo"), cfg.fuso);
  return NextResponse.json({ periodo: { chave: p.chave, rotulo: p.rotulo }, ...(await indicadoresDoBarbeiro(id, p)) });
});
