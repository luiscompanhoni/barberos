import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirCliente } from "@/lib/auth/sessao";
import { rota } from "@/lib/erros";
import { jogar } from "@/lib/jogos/motor";
import { limitar } from "@/lib/limite";
import { corpo } from "@/lib/validacao";

/**
 * Joga. O resultado e decidido e gravado aqui; a tela so anima. A `chave` (gerada pela tela a cada toque)
 * torna a chamada idempotente: repetir devolve a mesma jogada.
 */
export const POST = rota(async (req: Request, ctx: RouteContext<"/api/cliente/jogos/[id]/jogar">) => {
  const s = await exigirCliente();
  limitar(`jogar:${s.clienteId}`, 20, 60_000);
  const { id } = await ctx.params;
  const b = await corpo(req, z.object({ chave: z.string().regex(/^[\w-]{8,64}$/) }));
  return NextResponse.json(await jogar(s.clienteId, id, `cli:${s.clienteId}:${b.chave}`), { status: 201 });
});
