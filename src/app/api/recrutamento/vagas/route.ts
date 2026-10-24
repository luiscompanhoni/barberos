import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirSessao, GESTAO } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { rota, naoEncontrado } from "@/lib/erros";
import { corpo } from "@/lib/validacao";
import { auditar } from "@/lib/auditoria";
import { zVaga } from "@/lib/recrutamento/regras";
import { criarVaga } from "@/lib/recrutamento/servico";
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
  const b = await corpo(req, z.union([zVaga.extend({ id: z.string().min(1).max(40) }).strict(), z.object({ id: z.string().min(1).max(40), ativa: z.boolean() }).strict()]));
  await db.$transaction(async (tx) => {
    const { id, ...dados } = b;
    const editando = "titulo" in b;
    const r = await tx.vagaRecrutamento.updateMany({ where: { id, ...(editando ? { ativa: false } : {}) }, data: dados });
    if (!r.count) throw naoEncontrado("Vaga em rascunho");
    await auditar(tx, s.usuarioId, editando ? "recrutamento.vaga.editada" : "recrutamento.vaga.publicacao", "VagaRecrutamento", id, { ativa: b.ativa });
  });
  return NextResponse.json({ ok: true });
});
