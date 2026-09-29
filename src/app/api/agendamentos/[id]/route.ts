import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirSessao } from "@/lib/auth/sessao";
import { alterarAgendamento, alterarStatus } from "@/lib/agenda/agendamentos";
import { rota } from "@/lib/erros";
import { corpo, zId, zInstante } from "@/lib/validacao";

const schema = z.object({
  inicio: zInstante.optional(),
  fim: zInstante.optional(),
  barbeiroId: zId.optional(),
  servicoId: zId.optional(),
  status: z
    .enum(["MARCADO", "CONFIRMADO", "CHEGOU", "EM_ATENDIMENTO", "CONCLUIDO", "FALTOU", "CANCELADO"])
    .optional(),
});

export const PATCH = rota(async (req: Request, ctx: RouteContext<"/api/agendamentos/[id]">) => {
  const s = await exigirSessao();
  const { id } = await ctx.params;
  const { status, ...mud } = await corpo(req, schema);
  let ag;
  if (Object.values(mud).some((v) => v !== undefined)) ag = await alterarAgendamento(id, mud, s);
  if (status) ag = await alterarStatus(id, status, s);
  return NextResponse.json(ag ?? { ok: true });
});
