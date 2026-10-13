import type { Prisma, TipoMovimento } from "@prisma/client";
import { db } from "@/lib/db";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";

type Tx = Prisma.TransactionClient;

/**
 * Muda o saldo de um produto e grava o historico, na mesma transacao.
 * O incremento e atomico no banco (duas vendas ao mesmo tempo nao se perdem).
 */
export async function movimentar(
  tx: Tx,
  m: { produtoId: string; tipo: TipoMovimento; quantidade: number; usuarioId?: string | null; comandaId?: string | null; motivo?: string | null; custoUnitarioCentavos?: number | null },
) {
  if (m.quantidade === 0) return null;
  const p = await tx.produto.update({
    where: { id: m.produtoId },
    data: {
      estoque: { increment: m.quantidade },
      // Entrada com custo informado atualiza o custo do produto.
      ...(m.tipo === "ENTRADA" && m.custoUnitarioCentavos != null ? { custoCentavos: m.custoUnitarioCentavos } : {}),
    },
    select: { estoque: true },
  });
  return tx.movimentoEstoque.create({
    data: {
      produtoId: m.produtoId,
      tipo: m.tipo,
      quantidade: m.quantidade,
      saldoApos: p.estoque,
      custoUnitarioCentavos: m.custoUnitarioCentavos ?? null,
      comandaId: m.comandaId ?? null,
      usuarioId: m.usuarioId ?? null,
      motivo: m.motivo ?? null,
    },
  });
}

const SINAL: Record<"ENTRADA" | "CONSUMO" | "PERDA", 1 | -1> = { ENTRADA: 1, CONSUMO: -1, PERDA: -1 };

/**
 * Lancamento manual feito pela equipe:
 * - ENTRADA (compra), CONSUMO (usado no atendimento), PERDA (quebrou/venceu): quantidade positiva;
 * - AJUSTE: informa a contagem real e o sistema lanca a diferenca.
 */
export async function lancarMovimento(
  usuarioId: string,
  l: { produtoId: string; tipo: "ENTRADA" | "CONSUMO" | "PERDA" | "AJUSTE"; quantidade: number; custoUnitarioCentavos?: number | null; motivo?: string | null },
) {
  return db.$transaction(async (tx) => {
    const p = await tx.produto.findUnique({ where: { id: l.produtoId }, select: { estoque: true } });
    if (!p) throw naoEncontrado("Produto");
    if (l.tipo === "AJUSTE") {
      if (l.quantidade < 0) throw new ErroNegocio("A contagem não pode ser negativa.");
      const diferenca = l.quantidade - p.estoque;
      if (diferenca === 0) throw new ErroNegocio("A contagem é igual ao saldo atual: nada para ajustar.");
      return movimentar(tx, { produtoId: l.produtoId, tipo: "AJUSTE", quantidade: diferenca, usuarioId, motivo: l.motivo ?? "Contagem" });
    }
    if (l.quantidade <= 0) throw new ErroNegocio("Informe uma quantidade maior que zero.");
    return movimentar(tx, {
      produtoId: l.produtoId,
      tipo: l.tipo,
      quantidade: SINAL[l.tipo] * l.quantidade,
      usuarioId,
      motivo: l.motivo,
      custoUnitarioCentavos: l.tipo === "ENTRADA" ? l.custoUnitarioCentavos : null,
    });
  });
}
