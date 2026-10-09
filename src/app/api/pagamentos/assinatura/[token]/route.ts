import { NextResponse } from "next/server";
import { z } from "zod";
import { ativarComCartao, checkoutDaAssinatura, pagarPlanoComPix } from "@/lib/assinaturas/cartao-pix";
import { db } from "@/lib/db";
import { ErroNegocio, rota } from "@/lib/erros";
import { limitarTentativas, zCartaoToken } from "@/lib/pagamentos/checkout";
import { corpo } from "@/lib/validacao";

export const dynamic = "force-dynamic";

/**
 * Checkout do plano (publico: acessado pelo link com o codigo aleatorio da assinatura).
 * GET: situacao para a pagina se atualizar sozinha (?rapido=1 so le o banco).
 */
export const GET = rota(async (req: Request, ctx: RouteContext<"/api/pagamentos/assinatura/[token]">) => {
  const { token } = await ctx.params;
  const rapido = new URL(req.url).searchParams.get("rapido") === "1";
  return NextResponse.json({ checkout: await checkoutDaAssinatura(token, !rapido) });
});

/** Aba Pix: gera o Pix do 1o mes. Aba cartao: ativa (ou troca o cartao) com o TOKEN do cartao. */
export const POST = rota(async (req: Request, ctx: RouteContext<"/api/pagamentos/assinatura/[token]">) => {
  const { token } = await ctx.params;
  const b = await corpo(req, z.discriminatedUnion("forma", [
    z.object({ forma: z.literal("PIX") }),
    z.object({ forma: z.literal("CARTAO"), cartaoToken: zCartaoToken }),
  ]));
  limitarTentativas(`assinatura:${token}:${b.forma}`, b.forma === "CARTAO" ? 5 : 20);
  if (b.forma === "PIX") await pagarPlanoComPix(token);
  else if ((await ativarComCartao(token, b.cartaoToken)).status === "PENDENTE") {
    // Assinatura criada mas o 1o mes nao passou: recusado (ou ainda em analise).
    const ultima = await db.cobranca.findFirst({ where: { assinatura: { tokenPublico: token } }, orderBy: { criadaEm: "desc" } });
    if (ultima?.status === "ATRASADA") throw new ErroNegocio("O cartão não foi aceito. Confira os dados ou tente outro cartão.", 422, "cartao_recusado");
  }
  return NextResponse.json({ checkout: await checkoutDaAssinatura(token, false) }, { status: 201 });
});
