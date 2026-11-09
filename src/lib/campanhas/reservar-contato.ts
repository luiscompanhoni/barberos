import { db } from "@/lib/db";
import { impedimentoCampanha } from "./contato";

export const INTERVALO_CAMPANHAS_MS = 48 * 60 * 60 * 1000;
export const migracaoDoCliente = {
  where: { status: { in: ["ATIVA", "ATRASADA", "PENDENTE"] as ("ATIVA" | "ATRASADA" | "PENDENTE")[] } },
  select: { migracao: { select: { estado: true } } },
};

/** Duas campanhas não reservam contato com a mesma pessoa na mesma janela. */
export async function reservarContatoCampanha(id: string, clienteId: string, agora: number) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM clientes WHERE id = ${clienteId} FOR UPDATE`;
    const cliente = await tx.cliente.findUnique({ where: { id: clienteId }, select: { nome: true, telefone: true, aceitaMensagens: true, excluidoEm: true, conversa: { select: { estado: true, recusaAutomaticas: true } }, assinaturas: migracaoDoCliente } });
    if (!cliente) return false;
    const marcou = await tx.agendamento.count({ where: { clienteId, status: { in: ["MARCADO", "CONFIRMADO"] }, inicio: { gt: new Date(agora) } } });
    const pular = impedimentoCampanha(cliente, marcou > 0);
    if (!pular && await tx.campanhaEnvio.findFirst({ where: { clienteId, status: "ENVIADO", enviadoEm: { gte: new Date(agora - INTERVALO_CAMPANHAS_MS) } }, select: { id: true } })) return false;
    const ok = await tx.campanhaEnvio.updateMany({ where: { id, clienteId, status: "FILA" }, data: pular ? { status: "PULADO", erro: pular } : { status: "ENVIADO", enviadoEm: new Date(agora) } });
    return ok.count > 0 && !pular ? { nome: cliente.nome, telefone: cliente.telefone } : false;
  });
}
