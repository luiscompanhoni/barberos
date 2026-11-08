import type { Prisma } from "@prisma/client";

/** Chamar sob a trava da competência, antes de ler ou alterar regras da folha. */
export async function tocarPessoasDaFolha(tx: Prisma.TransactionClient, ids?: string[]) {
  const ordenados = ids ? [...new Set(ids)].sort() : null;
  if (ordenados?.length === 0) return;
  const pessoas = ordenados
    ? await tx.$queryRaw<{ id: string }[]>`SELECT id FROM checklist_pessoas WHERE id = ANY(${ordenados}::text[]) ORDER BY id FOR UPDATE`
    : await tx.$queryRaw<{ id: string }[]>`SELECT id FROM checklist_pessoas ORDER BY id FOR UPDATE`;
  // O lock isolado não renova um snapshot SERIALIZABLE iniciado antes da espera.
  // Uma versão MVCC obriga esse fechamento a recusar a prévia antiga com 40001.
  for (const pessoa of pessoas) {
    await tx.$executeRaw`UPDATE checklist_pessoas SET id = id WHERE id = ${pessoa.id}`;
  }
}
