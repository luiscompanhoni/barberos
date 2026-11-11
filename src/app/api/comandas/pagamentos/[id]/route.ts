import { NextResponse } from "next/server";
import { z } from "zod";
import { BALCAO, exigirSessao } from "@/lib/auth/sessao";
import { cancelarPagamento, modoMaquininha, simularAprovacao, sincronizarPedido } from "@/lib/comandas/maquininha";
import { comandaPosDoBarbeiro, formaCartaoPresencial, PAPEIS_PAGAMENTO_COMANDA } from "@/lib/comandas/maquininha-acesso";
import { detalheComanda } from "@/lib/comandas/servico";
import { db } from "@/lib/db";
import { ErroNegocio, naoEncontrado, proibido, rota } from "@/lib/erros";
import { corpoCobrancaEquipe } from "@/lib/pagamentos/http-equipe";

/** cancelar | conferir (consulta a maquininha caso o webhook atrase) | simular (modo de teste). */
export const PATCH = rota(async (req: Request, ctx: RouteContext<"/api/comandas/pagamentos/[id]">) => {
  const s = await exigirSessao(PAPEIS_PAGAMENTO_COMANDA);
  const { id } = await ctx.params;
  const b = await corpoCobrancaEquipe(req, z.object({ acao: z.enum(["cancelar", "conferir", "simular"]) }));
  const balcao = BALCAO.includes(s.papel);
  if (!balcao && (b.acao !== "conferir" || modoMaquininha() !== "stone" || !s.barbeiroId)) throw proibido();
  const pg = await db.pagamentoComanda.findUnique({ where: { id }, select: { comandaId: true, gatewayPedidoId: true, forma: true, antecipadoId: true, linkPagamentoId: true } });
  if (!balcao && (!pg || !formaCartaoPresencial(pg.forma) || pg.antecipadoId || pg.linkPagamentoId
    || (pg.gatewayPedidoId && !pg.gatewayPedidoId.startsWith("or_")) || !await comandaPosDoBarbeiro(s, pg.comandaId))) throw proibido();
  if (!pg) throw naoEncontrado("Pagamento");
  if (b.acao === "cancelar") await cancelarPagamento(s, id);
  else if (b.acao === "simular") await simularAprovacao(id);
  else if (pg.gatewayPedidoId) await sincronizarPedido(pg.gatewayPedidoId);
  else throw new ErroNegocio("O envio à maquininha está em conferência, sem número de pedido recebido. Aguarde o retorno ou peça à gerência para conferir na Stone; não cobre novamente.", 409, "maquininha_incerta");
  return NextResponse.json({ comanda: await detalheComanda(pg.comandaId) });
});
