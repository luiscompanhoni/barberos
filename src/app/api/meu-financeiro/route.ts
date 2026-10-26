import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirSessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { rota } from "@/lib/erros";
import { corpo } from "@/lib/validacao";
import { resumoPessoal } from "@/lib/equipe-regras";

export const dynamic = "force-dynamic";
const dataValida = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => { const d = new Date(s + "T00:00:00Z"); return Number.isFinite(+d) && d.toISOString().slice(0, 10) === s; });
export const GET = rota(async (req: Request) => {
  const s = await exigirSessao();
  const mes = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).parse(new URL(req.url).searchParams.get("mes"));
  const inicio = new Date(mes + "-01T00:00:00Z");
  const fim = new Date(inicio); fim.setUTCMonth(fim.getUTCMonth() + 1);
  const itens = await db.lancamentoPessoal.findMany({ where: { usuarioId: s.usuarioId, anulado: false, data: { gte: inicio, lt: fim } }, orderBy: [{ data: "desc" }, { criadoEm: "desc" }] });
  return NextResponse.json({ itens, resumo: resumoPessoal(itens) }, { headers: { "Cache-Control": "private, no-store" } });
});
export const POST = rota(async (req: Request) => {
  const s = await exigirSessao();
  const b = await corpo(req, z.object({ tipo: z.enum(["RECEITA", "DESPESA"]), descricao: z.string().trim().min(2).max(150), categoria: z.string().trim().min(2).max(60), valorCentavos: z.number().int().min(1).max(100_000_000), data: dataValida, realizado: z.boolean() }));
  const item = await db.lancamentoPessoal.create({ data: { ...b, usuarioId: s.usuarioId, data: new Date(b.data + "T00:00:00Z") } });
  return NextResponse.json({ id: item.id }, { status: 201 });
});
export const PATCH = rota(async (req: Request) => {
  const s = await exigirSessao();
  const b = await corpo(req, z.object({ id: z.string().min(1).max(40), anulado: z.boolean() }));
  await db.lancamentoPessoal.updateMany({ where: { id: b.id, usuarioId: s.usuarioId }, data: { anulado: b.anulado } });
  return NextResponse.json({ ok: true });
});
