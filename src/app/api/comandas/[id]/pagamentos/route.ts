import { NextResponse } from "next/server";
import { BALCAO, exigirSessao } from "@/lib/auth/sessao";
import { registrarPagamento } from "@/lib/comandas/maquininha";
import { schemaPagamento } from "@/lib/comandas/schemas";
import { detalheComanda } from "@/lib/comandas/servico";
import { rota } from "@/lib/erros";
import { corpoCobrancaEquipe } from "@/lib/pagamentos/http-equipe";

/** Recebe: dinheiro/"ja passei" entra pago; cartao/Pix na maquininha integrada fica aguardando. */
export const POST = rota(async (req: Request, ctx: RouteContext<"/api/comandas/[id]/pagamentos">) => {
  const s = await exigirSessao(BALCAO);
  const { id } = await ctx.params;
  const b = await corpoCobrancaEquipe(req, schemaPagamento);
  await registrarPagamento(s, id, b);
  return NextResponse.json({ comanda: await detalheComanda(id) }, { status: 201 });
});
