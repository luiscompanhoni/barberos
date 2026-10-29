import { NextResponse } from "next/server";
import { exigirSessao, GESTAO } from "@/lib/auth/sessao";
import { rota } from "@/lib/erros";
import { corpo } from "@/lib/validacao";
import { zEtapa } from "@/lib/recrutamento/regras";
import { excluirCandidatura, mudarEtapa } from "@/lib/recrutamento/servico";

/** Apaga a candidatura e os dados do candidato (LGPD: pedido da pessoa ou fim da selecao). */
export const DELETE = rota(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const s = await exigirSessao(GESTAO);
  await excluirCandidatura((await ctx.params).id, s.usuarioId);
  return NextResponse.json({ ok: true });
});
export const PATCH = rota(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const s = await exigirSessao(GESTAO);
  await mudarEtapa((await ctx.params).id, s.usuarioId, await corpo(req, zEtapa));
  return NextResponse.json({ ok: true });
});
