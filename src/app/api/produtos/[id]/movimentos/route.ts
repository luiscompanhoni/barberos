import { NextResponse } from "next/server";
import { exigirSessao } from "@/lib/auth/sessao";
import { lancarMovimento } from "@/lib/comandas/estoque";
import { schemaMovimento } from "@/lib/comandas/schemas";
import { db } from "@/lib/db";
import { rota } from "@/lib/erros";
import { corpo } from "@/lib/validacao";

/** Historico do produto (ultimos 100 movimentos). */
export const GET = rota(async (_req: Request, ctx: RouteContext<"/api/produtos/[id]/movimentos">) => {
  await exigirSessao(["DONO", "RECEPCAO"]);
  const { id } = await ctx.params;
  const movimentos = await db.movimentoEstoque.findMany({ where: { produtoId: id }, orderBy: { criadoEm: "desc" }, take: 100 });
  const usuarios = await db.usuario.findMany({
    where: { id: { in: [...new Set(movimentos.map((m) => m.usuarioId).filter((x): x is string => !!x))] } },
    select: { id: true, nome: true },
  });
  const nome = new Map(usuarios.map((u) => [u.id, u.nome]));
  return NextResponse.json(movimentos.map((m) => ({ ...m, usuario: m.usuarioId ? (nome.get(m.usuarioId) ?? null) : null })));
});

/** Entrada (compra), consumo, perda ou ajuste de contagem. */
export const POST = rota(async (req: Request, ctx: RouteContext<"/api/produtos/[id]/movimentos">) => {
  const s = await exigirSessao(["DONO", "RECEPCAO"]);
  const { id } = await ctx.params;
  const b = await corpo(req, schemaMovimento);
  const m = await lancarMovimento(s.usuarioId, { produtoId: id, ...b });
  return NextResponse.json(m, { status: 201 });
});
