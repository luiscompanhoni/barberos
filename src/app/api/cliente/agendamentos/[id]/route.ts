import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirCliente } from "@/lib/auth/sessao";
import { cancelarPeloCliente, remarcarPeloCliente } from "@/lib/agenda/cliente";
import { rota } from "@/lib/erros";
import { corpo, zId, zInstante } from "@/lib/validacao";

/** Remarcar (novo horario e, se quiser, outro barbeiro). */
export const PATCH = rota(async (req: Request, ctx: RouteContext<"/api/cliente/agendamentos/[id]">) => {
  const s = await exigirCliente();
  const { id } = await ctx.params;
  const b = await corpo(req, z.object({ inicio: zInstante, barbeiroId: zId.optional(), forcarAvulso: z.boolean().optional() }));
  return NextResponse.json(await remarcarPeloCliente(s.clienteId, id, b.inicio, b.barbeiroId, b.forcarAvulso));
});

export const DELETE = rota(async (_req: Request, ctx: RouteContext<"/api/cliente/agendamentos/[id]">) => {
  const s = await exigirCliente();
  const { id } = await ctx.params;
  await cancelarPeloCliente(s.clienteId, id);
  return NextResponse.json({ ok: true });
});
