import { NextResponse } from "next/server";
import { exigirSessao, GESTAO } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { rota, naoEncontrado } from "@/lib/erros";
import { corpo } from "@/lib/validacao";
import { avaliarCandidatura } from "@/lib/recrutamento/formularios";
import { zAvaliacao } from "@/lib/recrutamento/formularios-regras";
export const dynamic = "force-dynamic";
type Contexto = { params: Promise<{ id: string }> };
export const GET = rota(async (_req: Request, ctx: Contexto) => {
  await exigirSessao(GESTAO);
  const c = await db.candidaturaRecrutamento.findUnique({ where: { id: (await ctx.params).id }, select: { formularioVersao: true, formularioSnapshot: true, respostas: true, versao: true, avaliacoes: { orderBy: [{ criadoEm: "desc" }, { id: "desc" }], take: 50 } } });
  if (!c) throw naoEncontrado("Candidatura");
  return NextResponse.json(c, { headers: { "Cache-Control": "no-store" } });
});
export const POST = rota(async (req: Request, ctx: Contexto) => {
  const s = await exigirSessao(GESTAO);
  return NextResponse.json(await avaliarCandidatura(s.usuarioId, (await ctx.params).id, await corpo(req, zAvaliacao)), { status: 201 });
});
