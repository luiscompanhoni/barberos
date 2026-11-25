import type { Agendamento, Prisma } from "@prisma/client";
import { dataLocal } from "@/lib/agenda/tempo";
import { publicarNotificacao } from "./caixa";
import { textoAtendimento } from "./textos-agenda";

/** Um aviso por reserva principal, gravado junto da reserva e da fila de push. */
export async function notificarNovoAgendamento(tx: Prisma.TransactionClient, ag: Agendamento, fuso: string) {
  if (ag.adicionalDeId || !["MARCADO", "CONFIRMADO"].includes(ag.status) || ag.fim <= new Date()) return;
  const [detalhes, gestores] = await Promise.all([
    tx.agendamento.findUniqueOrThrow({ where: { id: ag.id }, select: {
      cliente: { select: { nome: true } }, servico: { select: { nome: true } },
      barbeiro: { select: { ativo: true, usuarioId: true, nome: true } },
      adicionais: { where: { status: { not: "CANCELADO" } }, select: { servico: { select: { nome: true } } }, orderBy: { inicio: "asc" } },
    } }),
    tx.usuario.findMany({ where: { ativo: true, papel: { in: ["DONO", "GERENTE"] } }, select: { id: true } }),
  ]);
  const profissional = detalhes.barbeiro?.ativo ? detalhes.barbeiro.usuarioId : null;
  const destinatarios = [...new Set([...gestores.map(u => u.id), ...(profissional ? [profissional] : [])])].sort();
  for (const usuarioId of destinatarios) {
    await publicarNotificacao({
      usuarioId, categoria: "EQUIPE", chave: `novo-agendamento:${ag.id}`,
      titulo: "Novo agendamento", corpo: textoAtendimento({ inicio: ag.inicio, cliente: detalhes.cliente.nome,
        barbeiro: detalhes.barbeiro.nome, servicos: [detalhes.servico.nome, ...detalhes.adicionais.map(a => a.servico.nome)] }, fuso),
      href: usuarioId === profissional ? `/minha-agenda?data=${dataLocal(ag.inicio, fuso)}` : `/recepcao?data=${dataLocal(ag.inicio, fuso)}&barbeiroId=${ag.barbeiroId}`,
      expiraEm: new Date(Math.min(+ag.fim, Date.now() + 90 * 86_400_000)),
      dados: { tipo: "NOVO_AGENDAMENTO", agendamentoId: ag.id, barbeiroId: ag.barbeiroId, inicio: ag.inicio.toISOString() },
    }, tx);
  }
}
