import { NextResponse } from "next/server";
import { BALCAO, exigirSessao } from "@/lib/auth/sessao";
import { dataLocal } from "@/lib/agenda/tempo";
import { consultarConferenciaPlano } from "@/lib/clientes/conferencia-plano";
import { db } from "@/lib/db";
import { naoEncontrado, rota } from "@/lib/erros";
import { contratosCelcoinDoCliente } from "@/lib/pagamentos/celcash-contratos";

export const GET = rota(async (_req: Request, ctx: RouteContext<"/api/clientes/[id]/conferencia-plano">) => {
  await exigirSessao(BALCAO);
  const { id } = await ctx.params;
  const cliente = await db.cliente.findFirst({ where: { id, excluidoEm: null }, select: { id: true } });
  if (!cliente) throw naoEncontrado("Cliente");
  const hoje = dataLocal(Date.now(), "America/Sao_Paulo");
  const [conferencia, contratos] = await Promise.all([consultarConferenciaPlano(id, hoje), contratosCelcoinDoCliente(id)]);
  return NextResponse.json({ conferencia, contratos, hoje }, { headers: { "Cache-Control": "private, no-store" } });
});
