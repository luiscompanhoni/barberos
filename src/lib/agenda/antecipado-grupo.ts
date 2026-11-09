import type { Prisma } from "@prisma/client";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";

/** Total efetivamente a pagar, inclusive extras de um horário cujo corte está no plano. */
export function totalAntecipado(grupo: { precoCentavos: number }[]) {
  return grupo.reduce((total, a) => total + a.precoCentavos, 0);
}

export async function grupoParaAntecipar(tx: Prisma.TransactionClient, clienteId: string, id: string) {
  const ag = await tx.agendamento.findFirst({ where: { id, clienteId, adicionalDeId: null }, include: {
    servico: { select: { nome: true } }, barbeiro: { select: { nome: true } }, antecipado: true, itemComanda: { select: { id: true } },
    adicionais: { where: { status: { not: "CANCELADO" } }, include: { itemComanda: { select: { id: true } }, antecipado: true, servico: { select: { nome: true } } }, orderBy: [{ inicio: "asc" }, { id: "asc" }] },
  } });
  if (!ag) throw naoEncontrado("Horário");
  const grupo = [ag, ...ag.adicionais];
  if (grupo.some(a => a.assinaturaId && a.precoCentavos > 0)) throw new ErroNegocio("Confira os valores cobertos pelo plano antes de pagar.", 409, "nao_pode");
  if (grupo.some(a => a.clienteId !== clienteId || a.barbeiroId !== ag.barbeiroId || !["MARCADO", "CONFIRMADO"].includes(a.status) || +a.inicio <= Date.now()) || ag.adicionais.some(a => a.origem !== "SITE" || a.antecipado)) {
    throw new ErroNegocio("O atendimento foi alterado. Atualize seus horários ou pague no balcão.", 409, "nao_pode");
  }
  if (grupo.some(a => a.itemComanda)) throw new ErroNegocio("Esse atendimento já está na comanda: pague no balcão.", 409, "na_comanda");
  const valorCentavos = totalAntecipado(grupo);
  if (valorCentavos <= 0) throw new ErroNegocio("Esse horário não tem valor a pagar.", 409, "nao_pode");
  return { ag, grupo, valorCentavos };
}

export async function conferirAntecipadoParaRemarcar(tx: Prisma.TransactionClient, id: string) {
  const a = await tx.pagamentoAntecipado.findUnique({ where: { agendamentoId: id } });
  if (a && (a.emissaoChave || ["PENDENTE", "PAGO", "CREDITADO"].includes(a.status))) {
    throw new ErroNegocio("Este horário tem pagamento emitido ou recebido. Fale com a barbearia antes de alterar os serviços ou o valor.", 409, "antecipado_existente");
  }
}
