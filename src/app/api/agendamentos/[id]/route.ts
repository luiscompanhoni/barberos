import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirSessao } from "@/lib/auth/sessao";
import { alterarAgendamento, alterarStatus } from "@/lib/agenda/agendamentos";
import { ErroNegocio, rota } from "@/lib/erros";
import { corpo, zId, zInstante } from "@/lib/validacao";

const statusAgendamento = z.enum(["MARCADO", "CONFIRMADO", "CHEGOU", "EM_ATENDIMENTO", "CONCLUIDO", "FALTOU", "CANCELADO"]);
const schema = z.object({
  cadeiraId: zId.nullable().optional(),
  motivo: z.string().trim().max(200).optional(),
  inicio: zInstante.optional(),
  fim: zInstante.optional(),
  barbeiroId: zId.optional(),
  servicoId: zId.optional(),
  status: statusAgendamento.optional(),
  statusAnterior: statusAgendamento.optional(),
});

export const PATCH = rota(async (req: Request, ctx: RouteContext<"/api/agendamentos/[id]">) => {
  const s = await exigirSessao();
  const { id } = await ctx.params;
  const { status, statusAnterior, ...mud } = await corpo(req, schema);
  if (statusAnterior && !status) throw new ErroNegocio("Informe a nova situação do atendimento.");
  if (status && Object.values(mud).some(v => v !== undefined)) throw new ErroNegocio("Altere o horário e a situação em operações separadas.");
  let ag;
  if (Object.values(mud).some((v) => v !== undefined)) ag = await alterarAgendamento(id, mud, s);
  if (status) ag = await alterarStatus(id, status, s, statusAnterior);
  return NextResponse.json(ag ?? { ok: true });
});
