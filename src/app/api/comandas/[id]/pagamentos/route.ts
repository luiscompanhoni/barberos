import { NextResponse } from "next/server";
import { exigirSessao } from "@/lib/auth/sessao";
import { registrarPagamento } from "@/lib/comandas/maquininha";
import { PAPEIS_PAGAMENTO_COMANDA } from "@/lib/comandas/maquininha-acesso";
import { schemaPagamento } from "@/lib/comandas/schemas";
import { detalheComanda } from "@/lib/comandas/servico";
import { rota } from "@/lib/erros";
import { corpoCobrancaEquipe } from "@/lib/pagamentos/http-equipe";

/** Recebe: dinheiro/"ja passei" entra pago; cartao/Pix na maquininha integrada fica aguardando. */
export const POST = rota(async (req: Request, ctx: RouteContext<"/api/comandas/[id]/pagamentos">) => {
  const s = await exigirSessao(PAPEIS_PAGAMENTO_COMANDA);
  const { id } = await ctx.params;
  const b = await corpoCobrancaEquipe(req, schemaPagamento);
  await registrarPagamento(s, id, b);
  return NextResponse.json({ comanda: await detalheComanda(id) }, { status: 201 });
});
