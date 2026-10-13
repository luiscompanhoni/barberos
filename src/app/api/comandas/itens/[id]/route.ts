import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirSessao } from "@/lib/auth/sessao";
import { alterarItem, detalheComanda } from "@/lib/comandas/servico";
import { db } from "@/lib/db";
import { naoEncontrado, rota } from "@/lib/erros";
import { corpo } from "@/lib/validacao";

/** Muda a quantidade (0 remove o item). */
export const PATCH = rota(async (req: Request, ctx: RouteContext<"/api/comandas/itens/[id]">) => {
  const s = await exigirSessao();
  const { id } = await ctx.params;
  const b = await corpo(req, z.object({ quantidade: z.number().int().min(0).max(999) }));
  const item = await db.itemComanda.findUnique({ where: { id }, select: { comandaId: true } });
  if (!item) throw naoEncontrado("Item");
  await alterarItem(s, id, b.quantidade);
  return NextResponse.json({ comanda: await detalheComanda(item.comandaId) });
});
