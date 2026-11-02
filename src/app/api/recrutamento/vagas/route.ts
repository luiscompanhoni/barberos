import { NextResponse } from "next/server";
import { exigirSessao, GESTAO } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { rota } from "@/lib/erros";
import { corpo } from "@/lib/validacao";
import { zVaga, zEdicaoVaga } from "@/lib/recrutamento/regras";
import { criarVaga } from "@/lib/recrutamento/servico";
import { alterarVaga } from "@/lib/recrutamento/vagas";
import { urlSite } from "@/lib/dominios";
export const dynamic = "force-dynamic";
export const GET = rota(async () => {
  await exigirSessao(GESTAO);
  const vagas = await db.vagaRecrutamento.findMany({ orderBy: { criadoEm: "desc" }, take: 200, include: { _count: { select: { candidaturas: true } } } });
  return NextResponse.json({ vagas: vagas.map((v) => ({ ...v, link: `${urlSite()}/vagas/${v.id}` })) }, { headers: { "Cache-Control": "no-store" } });
});
export const POST = rota(async (req: Request) => {
  const s = await exigirSessao(GESTAO);
  return NextResponse.json(await criarVaga(s.usuarioId, await corpo(req, zVaga)), { status: 201 });
});
export const PATCH = rota(async (req: Request) => {
  const s = await exigirSessao(GESTAO);
  await alterarVaga(s.usuarioId, await corpo(req, zEdicaoVaga));
  return NextResponse.json({ ok: true });
});
