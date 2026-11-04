import type { Prisma } from "@prisma/client";

/** A mesma trava é usada pelo gatilho de cadastro e pelo pedido do contato. */
export async function travarPreferencia(tx: Prisma.TransactionClient, telefone: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`whatsapp-optout:${telefone}`}, 0))`;
}

/** A troca de número segue a ordem adotada pelo gatilho do banco. */
export async function travarMudancaTelefone(tx: Prisma.TransactionClient, anterior: string, novo: string) {
  for (const telefone of [...new Set([anterior, novo])].sort()) await travarPreferencia(tx, telefone);
}

/** Chamar após travar o telefone; reativar exige uma ação explícita do titular. */
export async function atualizarPreferencia(tx: Prisma.TransactionClient, telefone: string, aceita: boolean) {
  await tx.conversa.updateMany({ where: { telefone }, data: { recusaAutomaticas: !aceita } });
  return tx.cliente.updateMany({ where: { telefone }, data: { aceitaMensagens: aceita } });
}
