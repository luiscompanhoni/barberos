import type { Agendamento, Prisma } from "@prisma/client";
import { dataLocal } from "@/lib/agenda/tempo";
import { publicarNotificacao } from "./caixa";

/** Um aviso por reserva principal, gravado junto da reserva e da fila de push. */
export async function notificarNovoAgendamento(tx: Prisma.TransactionClient, ag: Agendamento, fuso: string) {
  if (ag.adicionalDeId || !["MARCADO", "CONFIRMADO"].includes(ag.status) || ag.fim <= new Date()) return;
  const barbeiro = await tx.barbeiro.findUnique({
    where: { id: ag.barbeiroId }, select: { ativo: true, usuarioId: true },
  });
  if (!barbeiro?.ativo || !barbeiro.usuarioId) return;
  return publicarNotificacao({
    usuarioId: barbeiro.usuarioId, categoria: "EQUIPE", chave: `novo-agendamento:${ag.id}`,
    titulo: "Novo agendamento", corpo: "Um novo atendimento entrou na sua agenda. Abra para conferir o cliente e o horário.",
    href: `/minha-agenda?data=${dataLocal(ag.inicio, fuso)}`, expiraEm: new Date(Math.min(+ag.fim, Date.now() + 90 * 86_400_000)),
    dados: { tipo: "NOVO_AGENDAMENTO", agendamentoId: ag.id, barbeiroId: ag.barbeiroId },
  }, tx);
}
