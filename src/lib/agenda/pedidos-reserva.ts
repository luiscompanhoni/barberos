import type { Prisma } from "@prisma/client";
import { auditar } from "@/lib/auditoria";
import { ErroNegocio, naoEncontrado, proibido } from "@/lib/erros";
import { BALCAO, type Sessao } from "@/lib/auth/sessao";

export async function validarPedidoReserva(tx: Prisma.TransactionClient, id: string, ator: Sessao | null, entrada: { clienteId: string; barbeiroId: string; servicoIds: string[]; inicio: Date }) {
  if (!ator || !BALCAO.includes(ator.papel)) throw proibido();
  await tx.$queryRaw`SELECT id FROM pedidos_agendamento WHERE id = ${id} FOR UPDATE`;
  const p = await tx.pedidoAgendamento.findUnique({ where: { id } });
  if (!p || p.clienteId !== entrada.clienteId) throw naoEncontrado("Pedido");
  if (p.status === "APROVADO" && Array.isArray(p.agendamentoIds) && typeof p.agendamentoIds[0] === "string") {
    const ag = await tx.agendamento.findUnique({ where: { id: p.agendamentoIds[0] } });
    if (!ag || ag.barbeiroId !== entrada.barbeiroId || +ag.inicio !== +entrada.inicio) throw new ErroNegocio("Este pedido já foi aprovado com outro horário. Atualize a conferência.", 409, "pedido_decidido");
    return ag;
  }
  if (p.status !== "PENDENTE") throw new ErroNegocio("Este pedido já foi decidido.", 409, "pedido_decidido");
  if ((p.barbeiroId && p.barbeiroId !== entrada.barbeiroId) || JSON.stringify(p.servicoIds) !== JSON.stringify(entrada.servicoIds)) {
    throw new ErroNegocio("O pedido mudou. Confira o profissional e os serviços antes de aprovar.", 409, "pedido_alterado");
  }
  return null;
}

/** A aprovação e a reserva de todos os serviços são confirmadas juntas. */
export async function concluirPedido(tx: Prisma.TransactionClient, id: string, usuarioId: string, agendamentoIds: string[]) {
  await tx.pedidoAgendamento.update({ where: { id }, data: { status: "APROVADO", agendamentoIds, decididoPorId: usuarioId, decididoEm: new Date() } });
  await auditar(tx, usuarioId, "aprovar_pedido_agendamento", "pedido_agendamento", id, { agendamentoIds, agendaExternaConferida: true });
}
