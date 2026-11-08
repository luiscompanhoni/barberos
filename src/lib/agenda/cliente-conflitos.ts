import type { Prisma } from "@prisma/client";
import { ErroNegocio } from "@/lib/erros";
import { STATUS_ATIVOS } from "./carregar";
import type { Intervalo } from "./disponibilidade";

/** Chamador mantém a trava cliente:<id> até o commit. Filhos SITE já estão no intervalo do pai. */
export async function validarHorarioCliente(tx: Prisma.TransactionClient, clienteId: string, int: Intervalo, ignorarIds: string[] = []) {
  const choque = await tx.agendamento.findFirst({ where: { clienteId, OR: [{ adicionalDeId: null }, { ocupaAgenda: true }], status: { in: [...STATUS_ATIVOS] }, id: { notIn: ignorarIds }, inicio: { lt: new Date(int.fim) }, fim: { gt: new Date(int.inicio) } }, select: { id: true } });
  if (choque) throw new ErroNegocio("O cliente já tem um atendimento nesse período. Escolha outro horário.", 409, "choque_cliente");
}
