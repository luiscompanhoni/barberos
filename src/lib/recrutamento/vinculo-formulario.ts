import type { Prisma } from "@prisma/client";
import { ErroNegocio } from "@/lib/erros";
export async function conferirFormulario(tx: Prisma.TransactionClient, id: string | null | undefined) {
  if (!id) return;
  const r = await tx.formularioRecrutamento.updateMany({ where: { id, estado: "APROVADO" }, data: { revisao: { increment: 1 } } });
  if (!r.count) throw new ErroNegocio("Escolha um formulário aprovado e não arquivado.", 409);
}
