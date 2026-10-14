/**
 * Ligacao dos premios de jogo com a comanda (arquivo separado: a comanda importa daqui sem ciclo).
 */
import type { Prisma } from "@prisma/client";

/** Comanda cancelada: premios usados nela voltam para o cliente (dentro da transacao do cancelamento). */
export async function devolverPremiosDaComanda(tx: Prisma.TransactionClient, comandaId: string) {
  await tx.premioGanho.updateMany({
    where: { comandaId, status: "UTILIZADO", tipo: { not: "CREDITO" } },
    data: { status: "DISPONIVEL", utilizadoEm: null, validadoPorId: null, comandaId: null, descontoAplicadoCentavos: 0, agendamentoId: null },
  });
}

/** Premios abertos do cliente (para a recepcao ver na comanda). */
export async function premiosAbertosDoCliente(c: Prisma.TransactionClient | { premioGanho: Prisma.TransactionClient["premioGanho"] }, clienteId: string) {
  return c.premioGanho.findMany({
    where: { clienteId, status: { in: ["DISPONIVEL", "RESERVADO"] }, tipo: { not: "CREDITO" }, OR: [{ expiraEm: null }, { expiraEm: { gt: new Date() } }, { status: "RESERVADO" }] },
    orderBy: { expiraEm: "asc" },
    select: { id: true, codigo: true, rotulo: true, tipo: true, raridade: true, icone: true, valorCentavos: true, percentual: true, status: true, expiraEm: true, agendamentoId: true },
  });
}
