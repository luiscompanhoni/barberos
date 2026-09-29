import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirSessao } from "@/lib/auth/sessao";
import { obterAgendaBarbeiro, salvarExpediente } from "@/lib/agenda/expediente";
import { rota } from "@/lib/erros";
import { corpo, zIntervaloMin } from "@/lib/validacao";

/** Configuracao da agenda do barbeiro: semana padrao, excecoes e bloqueios futuros. */
export const GET = rota(async (_req: Request, ctx: RouteContext<"/api/barbeiros/[id]/agenda">) => {
  const s = await exigirSessao();
  const { id } = await ctx.params;
  return NextResponse.json(await obterAgendaBarbeiro(id, s));
});

/** Substitui a semana padrao. Devolve atendimentos que ficaram fora do novo horario. */
export const PUT = rota(async (req: Request, ctx: RouteContext<"/api/barbeiros/[id]/agenda">) => {
  const s = await exigirSessao();
  const { id } = await ctx.params;
  const { expediente } = await corpo(
    req,
    z.object({ expediente: z.array(zIntervaloMin.extend({ diaSemana: z.number().int().min(0).max(6) })).max(28) }),
  );
  return NextResponse.json(await salvarExpediente(id, expediente, s));
});
