import { NextResponse } from "next/server";
import { GESTAO, exigirSessao } from "@/lib/auth/sessao";
import { schemaProduto } from "@/lib/comandas/schemas";
import { db } from "@/lib/db";
import { ErroNegocio, rota } from "@/lib/erros";
import { corpo } from "@/lib/validacao";

/** Produtos (a equipe toda ve, para lancar na comanda). ?todos=1 inclui os desativados. */
export const GET = rota(async (req: Request) => {
  await exigirSessao();
  const todos = new URL(req.url).searchParams.get("todos") === "1";
  const produtos = await db.produto.findMany({
    where: todos ? {} : { ativo: true },
    orderBy: [{ categoria: "asc" }, { nome: "asc" }],
  });
  return NextResponse.json(produtos);
});

export const POST = rota(async (req: Request) => {
  await exigirSessao(GESTAO);
  const b = await corpo(req, schemaProduto);
  if (b.codigoBarras && (await db.produto.findUnique({ where: { codigoBarras: b.codigoBarras } }))) {
    throw new ErroNegocio("Já existe produto com esse código de barras.");
  }
  const p = await db.produto.create({ data: b });
  return NextResponse.json(p, { status: 201 });
});
