import type { Prisma } from "@prisma/client";
import { naoEncontrado } from "@/lib/erros";

export type TxLink = Prisma.TransactionClient;
export const INCLUIR_CLIENTE = { cliente: { select: { nome: true, cpf: true, email: true } }, comanda: { select: { numero: true, status: true } } } as const;

/** Ordem única: comanda antes do link, compartilhada com POS e confirmação do checkout. */
export async function travarLink(tx: TxLink, id: string) {
  const l = await tx.linkPagamento.findUnique({ where: { id }, select: { comandaId: true } });
  if (!l) throw naoEncontrado("Link de pagamento");
  if (l.comandaId) await tx.$queryRaw`SELECT 1 FROM comandas WHERE id = ${l.comandaId} FOR UPDATE`;
  await tx.$queryRaw`SELECT 1 FROM links_pagamento WHERE id = ${id} FOR UPDATE`;
  return tx.linkPagamento.findUniqueOrThrow({ where: { id }, include: INCLUIR_CLIENTE });
}

export function encerramentoPendente(chave: string | null) {
  const intencao = chave?.startsWith("conferir:") ? chave.slice("conferir:".length) : chave;
  return intencao?.startsWith("expirar:") ? "EXPIRADO" as const : intencao?.startsWith("cancelar:") ? "CANCELADO" as const : null;
}

export const limparTentativa = { gatewayId: null, tentativaChave: null, forma: null, parcelas: null, pixCopiaECola: null, pixQrUrl: null, pixExpiraEm: null };
