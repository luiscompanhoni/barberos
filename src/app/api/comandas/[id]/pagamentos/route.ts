import { NextResponse } from "next/server";
import { exigirSessao } from "@/lib/auth/sessao";
import { registrarPagamento } from "@/lib/comandas/maquininha";
import { schemaPagamento } from "@/lib/comandas/schemas";
import { detalheComanda } from "@/lib/comandas/servico";
import { rota } from "@/lib/erros";
import { corpo } from "@/lib/validacao";

/** Recebe: dinheiro/"ja passei" entra pago; cartao/Pix na maquininha integrada fica aguardando. */
export const POST = rota(async (req: Request, ctx: RouteContext<"/api/comandas/[id]/pagamentos">) => {
  const s = await exigirSessao();
  const { id } = await ctx.params;
  const b = await corpo(req, schemaPagamento);
  await registrarPagamento(s, id, b);
  return NextResponse.json({ comanda: await detalheComanda(id) }, { status: 201 });
});
