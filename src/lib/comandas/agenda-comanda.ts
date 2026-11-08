import type { Prisma } from "@prisma/client";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import { travarBarbeiro } from "@/lib/agenda/agendamentos";
import { configuracao } from "@/lib/agenda/carregar";
import { dataLocal } from "@/lib/agenda/tempo";
import { publicar } from "@/lib/eventos";

type Tx = Prisma.TransactionClient;

/** Ordem comum à agenda: ciclo do cliente → profissionais → quota → cadeiras → comanda. */
export async function travarAgendaComanda(tx: Tx, comandaId: string, profissionalExtra?: string) {
  const referencia = await tx.comanda.findUnique({ where: { id: comandaId }, select: { clienteId: true } });
  if (!referencia) throw naoEncontrado("Comanda");
  if (referencia.clienteId) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cliente-ciclo:${referencia.clienteId}`}))`;
  const c = await tx.comanda.findUniqueOrThrow({ where: { id: comandaId }, select: { clienteId: true, itens: { select: { agendamento: { select: { id: true, adicionalDeId: true } } } } } });
  if (c.clienteId !== referencia.clienteId) throw new ErroNegocio("O cliente da comanda mudou. Recarregue antes de continuar.", 409);
  const raizes = [...new Set(c.itens.flatMap(i => i.agendamento ? [i.agendamento.adicionalDeId ?? i.agendamento.id] : []))];
  const agendamentos = raizes.length ? await tx.agendamento.findMany({ where: { OR: [{ id: { in: raizes } }, { adicionalDeId: { in: raizes } }] }, select: { id: true, barbeiroId: true, cadeiraId: true } }) : [];
  const profissionais = [...new Set([...agendamentos.map(a => a.barbeiroId), ...(profissionalExtra ? [profissionalExtra] : [])])].sort();
  for (const id of profissionais) await travarBarbeiro(tx, id);
  if (c.clienteId) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cliente:${c.clienteId}`}))`;
  const extra = profissionalExtra ? await tx.barbeiro.findUnique({ where: { id: profissionalExtra }, select: { cadeiraId: true } }) : null;
  for (const id of [...new Set([...agendamentos.flatMap(a => a.cadeiraId ? [a.cadeiraId] : []), ...(extra?.cadeiraId ? [extra.cadeiraId] : [])])].sort()) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cadeira:${id}`}))`;
  return { clienteId: c.clienteId };
}

async function reservas(tx: Tx, ids: string[]) {
  return ids.length ? tx.agendamento.findMany({ where: { ocupaAgenda: true, OR: [{ id: { in: ids } }, { adicionalDeId: { in: ids } }] }, select: { id: true, adicionalDeId: true, status: true, barbeiroId: true, inicio: true, itemComanda: { select: { comandaId: true } } } }) : [];
}

export async function validarRemocaoAgendada(tx: Tx, agendamentoId: string | null, temPagamento: boolean) {
  if (!agendamentoId) return;
  const relacionados = await reservas(tx, [agendamentoId]);
  if (relacionados.some(a => a.id !== agendamentoId && !["CANCELADO", "FALTOU"].includes(a.status))) throw new ErroNegocio("Remova os adicionais reservados antes do atendimento principal.", 409, "adicional_reservado");
  const proprio = relacionados.find(a => a.id === agendamentoId);
  if (!proprio) return;
  if (!["MARCADO", "CONFIRMADO", "CANCELADO", "FALTOU"].includes(proprio.status)) throw new ErroNegocio("Este adicional já foi iniciado ou realizado. Revise o atendimento antes de remover o item.", 409, "adicional_iniciado");
  if (temPagamento) throw new ErroNegocio("Resolva os pagamentos da comanda antes de remover o adicional reservado.", 409, "adicional_pago");
}

export async function validarConclusaoAgendada(tx: Tx, ids: string[]) {
  if ((await reservas(tx, ids)).some(a => !["CONCLUIDO", "CANCELADO"].includes(a.status))) throw new ErroNegocio("Conclua os serviços adicionais na agenda ou remova os não realizados da comanda antes de fechar.", 409, "adicional_pendente");
}

/** Cancela somente reservas novas ainda não iniciadas; histórico concluído permanece intacto. */
export async function cancelarPendentesAgendados(tx: Tx, comandaId: string, ids: string[], fechada: boolean) {
  const pendentes = (await reservas(tx, ids)).filter(a => !["CONCLUIDO", "CANCELADO", "FALTOU"].includes(a.status));
  if (pendentes.some(a => a.itemComanda?.comandaId && a.itemComanda.comandaId !== comandaId)) throw new ErroNegocio("Há adicional em outra comanda. Revise os registros relacionados antes de cancelar.", 409, "adicional_outra_comanda");
  if (pendentes.some(a => !["MARCADO", "CONFIRMADO"].includes(a.status)) || fechada && pendentes.length) throw new ErroNegocio("Há adicional iniciado ou histórico incompatível. Revise o atendimento antes de cancelar a comanda.", 409, "adicional_iniciado");
  if (pendentes.length) await tx.agendamento.updateMany({ where: { id: { in: pendentes.map(a => a.id) } }, data: { status: "CANCELADO" } });
  return pendentes;
}

export async function publicarMudancasAgenda(registros: { barbeiroId: string; inicio: Date }[]) {
  if (!registros.length) return;
  const cfg = await configuracao();
  publicar({ tipo: "agenda", barbeiroIds: [...new Set(registros.map(a => a.barbeiroId))], datas: [...new Set(registros.map(a => dataLocal(a.inicio, cfg.fuso)))] });
}
