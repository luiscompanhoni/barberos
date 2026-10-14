import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirSessao, GESTAO } from "@/lib/auth/sessao";
import { liberarLote, mudarStatus } from "@/lib/campanhas/servico";
import { rota } from "@/lib/erros";
import { corpo } from "@/lib/validacao";

/** Libera o proximo lote ou pausa/retoma/encerra a campanha. */
export const PATCH = rota(async (req: Request, ctx: RouteContext<"/api/campanhas/[id]">) => {
  const s = await exigirSessao(GESTAO);
  const { id } = await ctx.params;
  const b = await corpo(req, z.discriminatedUnion("acao", [
    z.object({ acao: z.literal("lote"), quantidade: z.number().int().min(1).max(500) }),
    z.object({ acao: z.enum(["pausar", "retomar", "encerrar"]) }),
  ]));
  if (b.acao === "lote") return NextResponse.json(await liberarLote(s, id, b.quantidade));
  await mudarStatus(s, id, b.acao);
  return NextResponse.json({ ok: true });
});
