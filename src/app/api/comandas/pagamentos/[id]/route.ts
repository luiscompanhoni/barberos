import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirSessao } from "@/lib/auth/sessao";
import { cancelarPagamento, simularAprovacao, sincronizarPedido } from "@/lib/comandas/maquininha";
import { detalheComanda } from "@/lib/comandas/servico";
import { db } from "@/lib/db";
import { naoEncontrado, rota } from "@/lib/erros";
import { corpo } from "@/lib/validacao";

/** cancelar | conferir (consulta a maquininha caso o webhook atrase) | simular (modo de teste). */
export const PATCH = rota(async (req: Request, ctx: RouteContext<"/api/comandas/pagamentos/[id]">) => {
  const s = await exigirSessao();
  const { id } = await ctx.params;
  const b = await corpo(req, z.object({ acao: z.enum(["cancelar", "conferir", "simular"]) }));
  const pg = await db.pagamentoComanda.findUnique({ where: { id }, select: { comandaId: true, gatewayPedidoId: true } });
  if (!pg) throw naoEncontrado("Pagamento");
  if (b.acao === "cancelar") await cancelarPagamento(s, id);
  else if (b.acao === "simular") await simularAprovacao(id);
  else if (pg.gatewayPedidoId) await sincronizarPedido(pg.gatewayPedidoId);
  return NextResponse.json({ comanda: await detalheComanda(pg.comandaId) });
});
