import { NextResponse } from "next/server";
import { z } from "zod";
import { listaPublica, marcarPublico } from "@/lib/checklist/servico";
import { naoEncontrado, rota } from "@/lib/erros";
import { corpo } from "@/lib/validacao";

export const dynamic = "force-dynamic";

/** Link pessoal (sem login): a lista de hoje da pessoa. */
export const GET = rota(async (_req: Request, ctx: RouteContext<"/api/checklist/t/[token]">) => {
  const { token } = await ctx.params;
  const l = await listaPublica(token);
  if (!l) throw naoEncontrado("Link");
  return NextResponse.json(l);
});

export const PATCH = rota(async (req: Request, ctx: RouteContext<"/api/checklist/t/[token]">) => {
  const { token } = await ctx.params;
  const b = await corpo(req, z.object({ itemId: z.string().max(40), feito: z.boolean() }));
  await marcarPublico(token, b.itemId, b.feito);
  return NextResponse.json({ ok: true });
});
