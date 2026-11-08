import type { Prisma } from "@prisma/client";
import { ErroNegocio } from "@/lib/erros";
import type { Intervalo } from "./disponibilidade";

/** Deve ser chamada sob a trava do profissional, compartilhada com a confirmação de entrevistas. */
export async function conferirSemEntrevista(tx: Prisma.TransactionClient, barbeiroId: string, int: Intervalo) {
  const donoId = (await tx.barbeiro.findUnique({ where: { id: barbeiroId }, select: { usuarioId: true } }))?.usuarioId;
  if (donoId && await tx.entrevistaRecrutamento.findFirst({ where: { donoId, estado: "CONFIRMADA", inicio: { lt: new Date(int.fim) }, fim: { gt: new Date(int.inicio) } }, select: { id: true } })) throw new ErroNegocio("O profissional tem uma entrevista confirmada nesse horário. Resolva a entrevista antes de bloquear a agenda.", 409, "conflito_entrevista");
}
