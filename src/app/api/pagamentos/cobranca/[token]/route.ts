import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { naoEncontrado, rota } from "@/lib/erros";

/** Status da cobranca para a pagina publica de pagamento se atualizar sozinha. */
export const GET = rota(async (_req: Request, ctx: RouteContext<"/api/pagamentos/cobranca/[token]">) => {
  const { token } = await ctx.params;
  const c = await db.cobranca.findUnique({ where: { tokenPublico: token }, select: { status: true } });
  if (!c) throw naoEncontrado("Cobrança");
  return NextResponse.json(c);
});
