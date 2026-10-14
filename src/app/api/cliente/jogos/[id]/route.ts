import { NextResponse } from "next/server";
import { exigirCliente } from "@/lib/auth/sessao";
import { rota } from "@/lib/erros";
import { jogoDoCliente } from "@/lib/jogos/motor";

export const dynamic = "force-dynamic";

/** Um jogo (a tela do jogo carrega so ele). */
export const GET = rota(async (_req: Request, ctx: RouteContext<"/api/cliente/jogos/[id]">) => {
  const s = await exigirCliente();
  const { id } = await ctx.params;
  return NextResponse.json(await jogoDoCliente(s.clienteId, id));
});
