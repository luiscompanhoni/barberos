import { NextResponse } from "next/server";
import { z } from "zod";
import { ErroNegocio, rota } from "@/lib/erros";
import { json as corpoLimitado } from "@/lib/estudio/http";
import { identificarLinkCheckout } from "@/lib/links/checkout";
import { linkPublico, pagarLink } from "@/lib/links/servico";
import { limitarAcessoCheckout, limitarTentativas, zCartaoToken } from "@/lib/pagamentos/checkout";

export const dynamic = "force-dynamic";
const zToken = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/, "Link inválido.");

/**
 * Link de pagamento (publico: o token aleatorio e a "senha" do link).
 * GET: situacao para a pagina se atualizar sozinha (?rapido=1 so le o banco).
 */
export const GET = rota(async (req: Request, ctx: RouteContext<"/api/pagamentos/link/[token]">) => {
  limitarAcessoCheckout(req);
  const { token } = await ctx.params;
  zToken.parse(token);
  const rapido = new URL(req.url).searchParams.get("rapido") === "1";
  return NextResponse.json(await linkPublico(token, !rapido));
});

/** Pagar: gera o Pix ou cobra o cartao (so o TOKEN do cartao chega aqui). */
export const POST = rota(async (req: Request, ctx: RouteContext<"/api/pagamentos/link/[token]">) => {
  limitarAcessoCheckout(req);
  const { token } = await ctx.params;
  zToken.parse(token);
  if (Number(req.headers.get("content-length") ?? 0) > 32_768) throw new ErroNegocio("Dados acima do limite.", 413);
  const b = await corpoLimitado(req, z.object({
    forma: z.enum(["PIX", "CARTAO"]),
    cartaoToken: zCartaoToken.optional(),
    parcelas: z.number().int().min(1).max(12).optional(),
    cpf: z.string().max(20).optional(),
    email: z.string().trim().max(120).optional(),
  }));
  const id = await identificarLinkCheckout(token);
  limitarTentativas(`link:${id}:${b.forma}`, b.forma === "CARTAO" ? 5 : 20);
  return NextResponse.json({ checkout: await pagarLink(token, b) }, { status: 201 });
});
