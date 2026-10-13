import { NextResponse } from "next/server";
import { exigirSessao } from "@/lib/auth/sessao";
import { rota } from "@/lib/erros";
import { zDecidirEstorno } from "@/lib/estornos/schemas";
import { decidirEstorno } from "@/lib/estornos/servico";
import { corpo } from "@/lib/validacao";

/** So o dono: aprovar, recusar (com motivo), tentar de novo ou registrar que devolveu por fora. */
export const PATCH = rota(async (req: Request, ctx: RouteContext<"/api/estornos/[id]">) => {
  const s = await exigirSessao(["DONO"]);
  const { id } = await ctx.params;
  const b = await corpo(req, zDecidirEstorno);
  return NextResponse.json({ estorno: await decidirEstorno(s, id, b) });
});
