import { NextResponse } from "next/server";
import { z } from "zod";
import { configuracao } from "@/lib/agenda/carregar";
import { dataLocal } from "@/lib/agenda/tempo";
import { BALCAO, exigirSessao } from "@/lib/auth/sessao";
import { marcarNoPainel, painelDoDia } from "@/lib/checklist/servico";
import { db } from "@/lib/db";
import { rota } from "@/lib/erros";
import { corpo } from "@/lib/validacao";

export const dynamic = "force-dynamic";

/** Tarefas do dia de cada pessoa (padrao: hoje). */
export const GET = rota(async (req: Request) => {
  await exigirSessao(BALCAO);
  const q = new URL(req.url).searchParams.get("data");
  const data = q && /^\d{4}-\d{2}-\d{2}$/.test(q) ? q : dataLocal(Date.now(), (await configuracao()).fuso);
  const pessoas = await painelDoDia(data);
  const cfg = await db.checklistConfig.findUnique({ where: { id: 1 }, select: { pontosRe: true } });
  return NextResponse.json({ data, pessoas, pontosRe: cfg?.pontosRe ?? 20 });
});

/** Gerente marca/desmarca uma tarefa pelo painel. */
export const PATCH = rota(async (req: Request) => {
  const s = await exigirSessao(BALCAO);
  const b = await corpo(req, z.object({ itemId: z.string(), feito: z.boolean() }));
  await marcarNoPainel(s, b.itemId, b.feito);
  return NextResponse.json({ ok: true });
});
