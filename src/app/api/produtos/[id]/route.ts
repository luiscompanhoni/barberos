import { NextResponse } from "next/server";
import { z } from "zod";
import { auditarMudanca } from "@/lib/auditoria";
import { GESTAO, exigirSessao } from "@/lib/auth/sessao";
import { schemaProduto } from "@/lib/comandas/schemas";
import { db } from "@/lib/db";
import { ErroNegocio, rota } from "@/lib/erros";
import { corpo } from "@/lib/validacao";

/** Edita o cadastro. O saldo so muda por movimento (entrada, ajuste...). */
export const PATCH = rota(async (req: Request, ctx: RouteContext<"/api/produtos/[id]">) => {
  const sessao = await exigirSessao(GESTAO);
  const { id } = await ctx.params;
  const b = await corpo(req, schemaProduto.partial().extend({ ativo: z.boolean().optional() }));
  if (b.codigoBarras) {
    const outro = await db.produto.findUnique({ where: { codigoBarras: b.codigoBarras } });
    if (outro && outro.id !== id) throw new ErroNegocio("Já existe produto com esse código de barras.");
  }
  const p = await db.$transaction(async (tx) => {
    const atual = await tx.produto.findUniqueOrThrow({ where: { id } });
    await auditarMudanca(tx, sessao.usuarioId, "alterar", "produto", id, atual, b, { produto: atual.nome });
    return tx.produto.update({ where: { id }, data: b });
  });
  return NextResponse.json(p);
});
