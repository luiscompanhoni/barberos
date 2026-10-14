import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirSessaoCom } from "@/lib/auth/permissoes";
import { rota } from "@/lib/erros";
import { encerrarAdicional, excluirAdicional, listarAdicionais } from "@/lib/rh/adicionais";
import { corpo, zData } from "@/lib/validacao";

export const dynamic = "force-dynamic";

/** Encerra (data de fim) um adicional. */
export const PATCH = rota(async (req: Request, ctx: RouteContext<"/api/rh/comissoes/adicionais/[id]">) => {
  const s = await exigirSessaoCom("comissao");
  const { fim } = await corpo(req, z.object({ fim: zData }));
  await encerrarAdicional(s, (await ctx.params).id, fim);
  return NextResponse.json(await listarAdicionais());
});

/** Apaga um adicional que ainda nao comecou a valer. */
export const DELETE = rota(async (_req: Request, ctx: RouteContext<"/api/rh/comissoes/adicionais/[id]">) => {
  const s = await exigirSessaoCom("comissao");
  await excluirAdicional(s, (await ctx.params).id);
  return NextResponse.json(await listarAdicionais());
});
