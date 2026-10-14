import { NextResponse } from "next/server";
import { exigirCliente } from "@/lib/auth/sessao";
import { rota } from "@/lib/erros";
import { marcarRevelada } from "@/lib/jogos/motor";

/** A animacao terminou: a jogada deixa de aparecer como pendente. */
export const POST = rota(async (_req: Request, ctx: RouteContext<"/api/cliente/jogadas/[id]/revelar">) => {
  const s = await exigirCliente();
  const { id } = await ctx.params;
  await marcarRevelada(s.clienteId, id);
  return NextResponse.json({ ok: true });
});
