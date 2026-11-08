import type { Prisma } from "@prisma/client";
import { configuracao, limitesDoDia, STATUS_ATIVOS } from "@/lib/agenda/carregar";
import { travarBarbeiro } from "@/lib/agenda/agendamentos";
import { colunaParaData, dataLocal, dataParaColuna } from "@/lib/agenda/tempo";

/** Compartilha a trava com reservas/transferências da cadeira do dono. */
export async function travarProfissionalDono(tx: Prisma.TransactionClient, donoId: string) {
  const barbeiro = await tx.barbeiro.findUnique({ where: { usuarioId: donoId }, select: { id: true } });
  if (barbeiro) await travarBarbeiro(tx, barbeiro.id);
}

export async function ocupacoesProfissionalDono(tx: Prisma.TransactionClient, donoId: string, inicio: Date, fim: Date) {
  const barbeiro = await tx.barbeiro.findUnique({ where: { usuarioId: donoId }, select: { id: true } });
  if (!barbeiro) return [];
  const { fuso } = await configuracao(tx);
  const intervalo = { inicio: { lt: fim }, fim: { gt: inicio } };
  const [atendimentos, bloqueios, folgas] = await Promise.all([
    tx.agendamento.findMany({ where: { barbeiroId: barbeiro.id, OR: [{ adicionalDeId: null }, { ocupaAgenda: true }], status: { in: [...STATUS_ATIVOS] }, ...intervalo }, select: { inicio: true, fim: true } }),
    tx.bloqueio.findMany({ where: { barbeiroId: barbeiro.id, ...intervalo }, select: { inicio: true, fim: true } }),
    tx.excecaoAgenda.findMany({ where: { barbeiroId: barbeiro.id, tipo: "FOLGA", data: { gte: dataParaColuna(dataLocal(inicio, fuso)), lte: dataParaColuna(dataLocal(+fim - 1, fuso)) } }, select: { data: true } }),
  ]);
  return [...atendimentos, ...bloqueios, ...folgas.map(f => { const dia = limitesDoDia(colunaParaData(f.data), fuso); return { inicio: new Date(dia.inicio), fim: new Date(dia.fim) }; })];
}
