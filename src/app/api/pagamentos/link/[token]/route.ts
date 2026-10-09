import { NextResponse } from "next/server";
import { z } from "zod";
import { rota } from "@/lib/erros";
import { linkPublico, pagarLink } from "@/lib/links/servico";
import { limitarTentativas, zCartaoToken } from "@/lib/pagamentos/checkout";
import { corpo } from "@/lib/validacao";

export const dynamic = "force-dynamic";

/**
 * Link de pagamento (publico: o token aleatorio e a "senha" do link).
 * GET: situacao para a pagina se atualizar sozinha (?rapido=1 so le o banco).
 */
export const GET = rota(async (req: Request, ctx: RouteContext<"/api/pagamentos/link/[token]">) => {
  const { token } = await ctx.params;
  const rapido = new URL(req.url).searchParams.get("rapido") === "1";
  return NextResponse.json(await linkPublico(token, !rapido));
});

/** Pagar: gera o Pix ou cobra o cartao (so o TOKEN do cartao chega aqui). */
export const POST = rota(async (req: Request, ctx: RouteContext<"/api/pagamentos/link/[token]">) => {
  const { token } = await ctx.params;
  const b = await corpo(req, z.object({
    forma: z.enum(["PIX", "CARTAO"]),
    cartaoToken: zCartaoToken.optional(),
    parcelas: z.number().int().min(1).max(12).optional(),
    cpf: z.string().max(20).optional(),
    email: z.string().trim().max(120).optional(),
  }));
  limitarTentativas(`link:${token}:${b.forma}`, b.forma === "CARTAO" ? 5 : 20);
  return NextResponse.json({ checkout: await pagarLink(token, b) }, { status: 201 });
});
