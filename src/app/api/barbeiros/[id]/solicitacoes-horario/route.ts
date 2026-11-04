import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirSessao } from "@/lib/auth/sessao";
import { rota } from "@/lib/erros";
import { corpo } from "@/lib/validacao";
import { decidirSemana, listarSolicitacoes, semanaHorario, solicitarSemana } from "@/lib/agenda/solicitacoes-horario";
import { periodoHorario, solicitarPeriodo } from "@/lib/agenda/solicitacoes-periodo";

export const GET = rota(async (_req: Request, ctx: RouteContext<"/api/barbeiros/[id]/solicitacoes-horario">) => {
  const s = await exigirSessao();
  const { id } = await ctx.params;
  return NextResponse.json(await listarSolicitacoes(id, s), { headers: { "Cache-Control": "private, no-store" } });
});

export const POST = rota(async (req: Request, ctx: RouteContext<"/api/barbeiros/[id]/solicitacoes-horario">) => {
  const s = await exigirSessao();
  const { id } = await ctx.params;
  const b = await corpo(req, z.discriminatedUnion("acao", [
    z.object({ acao: z.literal("solicitar"), semana: semanaHorario }),
    z.object({ acao: z.literal("solicitar_periodo"), tipo: z.enum(["FOLGA", "BLOQUEIO"]), periodo: periodoHorario }),
    z.object({ acao: z.literal("decidir"), pedidoId: z.string().min(1).max(40), decisao: z.enum(["aprovar", "recusar"]), motivo: z.string().trim().max(500).optional() }),
  ]));
  return NextResponse.json(b.acao === "solicitar" ? await solicitarSemana(id, b.semana, s) : b.acao === "solicitar_periodo" ? await solicitarPeriodo(id, b.tipo, b.periodo, s) : await decidirSemana(id, b.pedidoId, b.decisao, b.motivo, s));
});
