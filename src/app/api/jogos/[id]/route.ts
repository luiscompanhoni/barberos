import { NextResponse } from "next/server";
import { z } from "zod";
import { GESTAO, exigirSessao } from "@/lib/auth/sessao";
import { rota } from "@/lib/erros";
import { zConfig, zPremio } from "@/lib/jogos/esquema";
import { salvarJogo } from "@/lib/jogos/painel";
import { corpo } from "@/lib/validacao";

/** Dono/gerente salvam a configuracao e os premios de um jogo (so com chances somando 100%). */
export const PUT = rota(async (req: Request, ctx: RouteContext<"/api/jogos/[id]">) => {
  const s = await exigirSessao(GESTAO);
  const { id } = await ctx.params;
  const b = await corpo(req, z.object({ config: zConfig, premios: z.array(zPremio).min(1).max(30) }));
  return NextResponse.json(await salvarJogo(s, id, b.config, b.premios));
});
