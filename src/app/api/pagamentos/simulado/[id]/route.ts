import { NextResponse } from "next/server";
import { processarEventoGateway } from "@/lib/assinaturas/cobrancas";
import { BALCAO, exigirSessao } from "@/lib/auth/sessao";
import { ErroNegocio, rota } from "@/lib/erros";
import { provedorPagamento } from "@/lib/pagamentos/gateway";
import { pagarSimulada } from "@/lib/pagamentos/simulado";
import { sincronizarAntecipado } from "@/lib/agenda/antecipado";
import { sincronizarLink } from "@/lib/links/servico";
import { db } from "@/lib/db";

/**
 * "Paga" uma cobranca simulada (o equivalente a pagar a fatura do Asaas) e
 * dispara o mesmo processamento do webhook. Nao existe fora do modo simulado.
 */
export const POST = rota(async (_req: Request, ctx: RouteContext<"/api/pagamentos/simulado/[id]">) => {
  if (provedorPagamento() !== "simulado") throw new ErroNegocio("Indisponível.", 404);
  // Em producao sem meio de pagamento real, so a equipe confirma (mensalidade recebida no balcao).
  if (process.env.NODE_ENV === "production") await exigirSessao(BALCAO);
  const { id } = await ctx.params;
  await pagarSimulada(id);
  // Horario pago antes, link de pagamento (cobrancas avulsas) ou mensalidade.
  const ant = await db.pagamentoAntecipado.findUnique({ where: { gatewayId: id } });
  const link = ant ? null : await db.linkPagamento.findUnique({ where: { gatewayId: id } });
  if (ant) await sincronizarAntecipado(ant.id);
  else if (link) await sincronizarLink(link.id);
  else await processarEventoGateway(`sim_${id}_pago`, "PAYMENT_RECEIVED", id);
  return NextResponse.json({ ok: true });
});
