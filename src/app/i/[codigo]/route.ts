import { NextResponse } from "next/server";
import { COOKIE_INDICACAO, donoDoCodigo } from "@/lib/crescimento/indicacao";
import { cookieSeguro, urlSite } from "@/lib/dominios";

/**
 * Link de indicacao (blackbarber.com.br/i/RAFA7K2): guarda o codigo por 30 dias e abre a
 * pagina de venda. O codigo vale quando a pessoa entra na area do cliente pela primeira vez.
 */
export async function GET(_req: Request, ctx: RouteContext<"/i/[codigo]">) {
  const { codigo } = await ctx.params;
  const dono = await donoDoCodigo(codigo);
  const res = NextResponse.redirect(`${urlSite()}/`);
  if (dono) {
    res.cookies.set(COOKIE_INDICACAO, codigo.toUpperCase(), {
      httpOnly: true, sameSite: "lax", secure: cookieSeguro(), path: "/", maxAge: 30 * 24 * 3600,
    });
  }
  return res;
}
