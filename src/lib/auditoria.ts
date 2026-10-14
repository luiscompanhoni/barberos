import type { Prisma } from "@prisma/client";
import { headers } from "next/headers";
import { mudancas } from "./auditoria-regras";

type Tx = Prisma.TransactionClient;

/** IP e aparelho de quem fez, quando a acao vem de uma requisicao (rotinas e scripts ficam sem). */
export async function origemDaRequisicao() {
  try {
    const h = await headers();
    // O Caddy troca o X-Forwarded-For pelo IP real do cliente: o primeiro da lista e confiavel.
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
    const ua = h.get("user-agent");
    return { ip: ip ? ip.slice(0, 64) : null, dispositivo: ua ? ua.slice(0, 200) : null };
  } catch {
    return { ip: null, dispositivo: null };
  }
}

/** Registra quem mudou o que (dentro da mesma transacao da mudanca). O log nao se altera nem se apaga. */
export async function auditar(
  tx: Tx,
  usuarioId: string | null,
  acao: string,
  entidade: string,
  entidadeId: string,
  dados?: Prisma.InputJsonValue,
) {
  await tx.auditoria.create({ data: { usuarioId, acao, entidade, entidadeId, dados, ...(await origemDaRequisicao()) } });
}

/** Registra uma alteracao com { antes, depois } so dos campos que mudaram (nada mudou = nao registra). */
export async function auditarMudanca(
  tx: Tx,
  usuarioId: string | null,
  acao: string,
  entidade: string,
  entidadeId: string,
  atual: Record<string, unknown>,
  novos: Record<string, unknown>,
  extra?: Record<string, unknown>,
) {
  const m = mudancas(atual, novos);
  if (m) await auditar(tx, usuarioId, acao, entidade, entidadeId, { ...extra, ...m } as Prisma.InputJsonValue);
}
