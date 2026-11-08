import type { Prisma } from "@prisma/client";
import { ErroNegocio } from "@/lib/erros";

/** Mantém pai/filhos coerentes; uma mudança isolada não desloca serviço já lançado na comanda. */
export async function conferirSemReservaAdicional(tx: Prisma.TransactionClient, id: string, proprio = false) {
  if (proprio || await tx.agendamento.count({ where: { adicionalDeId: id, ocupaAgenda: true, status: { notIn: ["CANCELADO", "FALTOU"] } } })) {
    throw new ErroNegocio("Este atendimento tem serviço adicional com horário reservado. Resolva os adicionais na comanda antes de mudar o horário.", 409, "adicional_reservado");
  }
}
