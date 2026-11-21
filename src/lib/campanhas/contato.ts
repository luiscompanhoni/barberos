import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { travarPreferencia } from "@/lib/whatsapp/preferencia";

/** Pausa da campanha e recusa do titular devem confirmar antes ou depois da entrega em curso. */
export function comPreferenciaCampanha<T>(
  campanhaId: string, telefone: string, executar: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`campanha:${campanhaId}`}))`;
    await travarPreferencia(tx, telefone);
    return executar(tx);
  }, { maxWait: 10_000, timeout: 60_000 });
}

export function impedimentoCampanha(c: {
  aceitaMensagens: boolean;
  excluidoEm: Date | null;
  conversa: { estado: string; recusaAutomaticas: boolean } | null;
  assinaturas?: { migracao: { estado: string } | null }[];
}, temHorario = false) {
  if (c.excluidoEm) return "Cadastro excluído.";
  if (!c.aceitaMensagens || c.conversa?.recusaAutomaticas) return "Pediu para não receber mensagens.";
  if (c.conversa?.estado === "HUMANO") return "Atendimento com a equipe; revisar antes de novo convite.";
  if (c.assinaturas?.some((a) => a.migracao && a.migracao.estado !== "CONCLUIDO")) return "Migração em acompanhamento; priorizar a ajuda antes de nova campanha.";
  return temHorario ? "Já tem horário marcado." : null;
}
