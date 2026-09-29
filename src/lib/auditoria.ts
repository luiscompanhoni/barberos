import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

/** Registra quem mudou o que (dentro da mesma transacao da mudanca). */
export async function auditar(
  tx: Tx,
  usuarioId: string | null,
  acao: string,
  entidade: string,
  entidadeId: string,
  dados?: Prisma.InputJsonValue,
) {
  await tx.auditoria.create({ data: { usuarioId, acao, entidade, entidadeId, dados } });
}
