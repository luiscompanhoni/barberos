import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirSessao, GESTAO } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { rota } from "@/lib/erros";
import { corpo } from "@/lib/validacao";
import { criarFormulario, alterarFormulario } from "@/lib/recrutamento/formularios";
import { zFormulario } from "@/lib/recrutamento/formularios-regras";
import { MODELOS } from "@/lib/recrutamento/modelos-formularios";
export const dynamic = "force-dynamic";
export const GET = rota(async () => {
  await exigirSessao(GESTAO);
  const formularios = await db.formularioRecrutamento.findMany({ orderBy: [{ criadoEm: "desc" }, { id: "desc" }], take: 200 });
  return NextResponse.json({ formularios, modelos: MODELOS }, { headers: { "Cache-Control": "no-store" } });
});
export const POST = rota(async (req: Request) => {
  const s = await exigirSessao(GESTAO);
  const b = await corpo(req, zFormulario.extend({ origemId: z.string().min(1).max(40).optional() }).strict());
  const { origemId, ...dados } = b;
  return NextResponse.json(await criarFormulario(s.usuarioId, dados, origemId), { status: 201 });
});
export const PATCH = rota(async (req: Request) => {
  const s = await exigirSessao(GESTAO);
  const b = await corpo(req, z.object({ id: z.string().min(1).max(40), revisao: z.number().int().min(0), alteracao: z.union([zFormulario, z.enum(["APROVAR", "ARQUIVAR"])]) }).strict());
  await alterarFormulario(s.usuarioId, b.id, b.revisao, b.alteracao);
  return NextResponse.json({ ok: true });
});
