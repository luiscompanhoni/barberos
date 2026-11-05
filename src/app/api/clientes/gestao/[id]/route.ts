import { NextResponse } from "next/server";
import { BALCAO, exigirSessao } from "@/lib/auth/sessao";
import { rota } from "@/lib/erros";
import { corpoCobrancaEquipe } from "@/lib/pagamentos/http-equipe";
import { detalharCliente, editarCliente } from "@/lib/clientes/gestao";
import { zEditarClienteGestao } from "@/lib/clientes/gestao-regras";

export const GET = rota(async (_req: Request, ctx: RouteContext<"/api/clientes/gestao/[id]">) => {
  await exigirSessao(BALCAO);
  return NextResponse.json(await detalharCliente((await ctx.params).id), { headers: { "Cache-Control": "private, no-store" } });
});
export const PATCH = rota(async (req: Request, ctx: RouteContext<"/api/clientes/gestao/[id]">) => {
  const s = await exigirSessao(BALCAO);
  return NextResponse.json(await editarCliente((await ctx.params).id, await corpoCobrancaEquipe(req, zEditarClienteGestao), s.usuarioId));
});
