import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { auditar } from "@/lib/auditoria";
import { type Sessao } from "@/lib/auth/sessao";
import { ErroNegocio, proibido } from "@/lib/erros";
import { configuracao } from "./carregar";
import { instanteLocal, somarDias } from "./tempo";
import { travarBarbeiro } from "./agendamentos";

export const periodoHorario = z.object({ data: z.iso.date(), inicioMin: z.number().int().min(0).max(1439), fimMin: z.number().int().min(1).max(1440), motivo: z.string().trim().max(500).default("") }).refine(p => p.fimMin > p.inicioMin, "O fim precisa ser depois do início.");
export type PeriodoHorario = z.infer<typeof periodoHorario>;
type Tx = Prisma.TransactionClient;

export async function limitesPeriodo(tx: Tx, p: PeriodoHorario) {
  const { fuso } = await configuracao(tx);
  const inicio = new Date(instanteLocal(p.data, p.inicioMin, fuso));
  const fim = new Date(p.fimMin === 1440 ? instanteLocal(somarDias(p.data, 1), 0, fuso) : instanteLocal(p.data, p.fimMin, fuso));
  return { inicio, fim };
}

export async function conflitosPeriodo(tx: Tx, barbeiroId: string, p: PeriodoHorario) {
  const { inicio, fim } = await limitesPeriodo(tx, p);
  return tx.agendamento.findMany({
    where: { barbeiroId, status: { in: ["MARCADO", "CONFIRMADO", "CHEGOU", "EM_ATENDIMENTO"] }, inicio: { lt: fim }, fim: { gt: inicio } },
    select: { id: true, inicio: true, fim: true, cliente: { select: { nome: true } }, servico: { select: { nome: true } } }, orderBy: { inicio: "asc" },
  });
}

export async function solicitarPeriodo(barbeiroId: string, tipo: "FOLGA" | "BLOQUEIO", entrada: PeriodoHorario, ator: Sessao) {
  if (ator.papel !== "BARBEIRO" || ator.barbeiroId !== barbeiroId) throw proibido();
  const p = periodoHorario.parse(tipo === "FOLGA" ? { ...entrada, inicioMin: 0, fimMin: 1440 } : entrada);
  return db.$transaction(async tx => {
    await travarBarbeiro(tx, barbeiroId);
    const { inicio } = await limitesPeriodo(tx, p);
    if (inicio <= new Date()) throw new ErroNegocio("Solicite um período que ainda não começou.");
    if (await tx.solicitacaoHorario.findFirst({ where: { barbeiroId, status: "PENDENTE" } })) throw new ErroNegocio("Já existe uma solicitação pendente para este profissional.", 409);
    const pedido = await tx.solicitacaoHorario.create({ data: { barbeiroId, solicitadoPorId: ator.usuarioId, tipo, original: [], proposto: p } });
    await auditar(tx, ator.usuarioId, "solicitar_horario", "solicitacao_horario", pedido.id, { barbeiroId, tipo, proposto: p });
    return { ...pedido, conflitos: await conflitosPeriodo(tx, barbeiroId, p) };
  });
}
