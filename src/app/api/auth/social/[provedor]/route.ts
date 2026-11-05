import { NextResponse } from "next/server";
import { rota } from "@/lib/erros";
import { exigirOrigemCliente } from "@/lib/auth/http-cliente";
import { iniciarSocial } from "@/lib/auth/social";
import { zProvedorSocial } from "@/lib/auth/social-provedores";

export const POST = rota(async (req: Request, ctx: RouteContext<"/api/auth/social/[provedor]">) => {
  exigirOrigemCliente(req);
  const { provedor } = await ctx.params;
  return NextResponse.redirect(await iniciarSocial(zProvedorSocial.parse(provedor)), 303);
});
