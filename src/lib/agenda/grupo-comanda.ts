import type { Prisma } from "@prisma/client";

/** Consulta itens do grupo, inclusive serviços já cancelados. */
export async function grupoTemComanda(tx: Prisma.TransactionClient, id: string, opts: { somenteSeGrupo?: boolean; adicionalDeId?: string | null } = {}) {
  const filhos = await tx.agendamento.findMany({ where: { adicionalDeId: id }, select: { id: true } });
  if (opts.somenteSeGrupo && !opts.adicionalDeId && !filhos.length) return false;
  return !!await tx.itemComanda.findFirst({ where: { agendamentoId: { in: [id, ...filhos.map(f => f.id)] } }, select: { id: true } });
}
