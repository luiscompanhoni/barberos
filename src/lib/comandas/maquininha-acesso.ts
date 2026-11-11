import type { Prisma } from "@prisma/client";
import { BALCAO, type Sessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";

export const PAPEIS_PAGAMENTO_COMANDA = [...BALCAO, "BARBEIRO" as const];

export function formaCartaoPresencial(forma: string) {
  return forma === "DEBITO" || forma === "CREDITO";
}

/** Uma comanda compartilhada ou sem atendimento atribuído é cobrada no balcão. */
export async function comandaPosDoBarbeiro(s: Sessao, id: string, conexao: Pick<Prisma.TransactionClient, "comanda"> = db) {
  if (s.papel !== "BARBEIRO" || !s.barbeiroId) return false;
  const barbeiroId = s.barbeiroId;
  return !!await conexao.comanda.findFirst({
    where: {
      id,
      itens: {
        some: { agendamento: { is: { barbeiroId, status: { notIn: ["CANCELADO", "FALTOU"] } } } },
        none: {
          OR: [
            { agendamento: { is: { barbeiroId: { not: barbeiroId } } } },
            { barbeiroId: { not: barbeiroId } },
          ],
        },
      },
    },
    select: { id: true },
  });
}
