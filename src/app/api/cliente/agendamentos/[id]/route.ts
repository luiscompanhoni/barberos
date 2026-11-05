import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirCliente } from "@/lib/auth/sessao";
import { cancelarPeloCliente, remarcarPeloCliente } from "@/lib/agenda/cliente";
import { rota } from "@/lib/erros";
import { zId, zInstante } from "@/lib/validacao";
import { corpoPedido } from "@/lib/agenda/pedidos-regras";
import { exigirOrigemCliente } from "@/lib/auth/http-cliente";

/** Remarcar (novo horario e, se quiser, outro barbeiro). */
export const PATCH = rota(async (req: Request, ctx: RouteContext<"/api/cliente/agendamentos/[id]">) => {
  const s = await exigirCliente();
  const { id } = await ctx.params;
  const b = await corpoPedido(req, z.object({ inicio: zInstante, barbeiroId: zId.optional(), forcarAvulso: z.boolean().optional(),
    precoEsperadoCentavos: z.number().int().nonnegative().optional(), duracaoEsperadaMin: z.number().int().min(5).max(480) }).strict());
  return NextResponse.json(await remarcarPeloCliente(s.clienteId, id, b.inicio, b.barbeiroId, b.forcarAvulso, b.precoEsperadoCentavos,
    { usuarioId: s.usuarioId, sessaoVersao: s.sessaoVersao ?? 0 }, b.duracaoEsperadaMin));
});

export const DELETE = rota(async (req: Request, ctx: RouteContext<"/api/cliente/agendamentos/[id]">) => {
  const s = await exigirCliente();
  exigirOrigemCliente(req);
  const { id } = await ctx.params;
  await cancelarPeloCliente(s.clienteId, id, { usuarioId: s.usuarioId, sessaoVersao: s.sessaoVersao ?? 0 });
  return NextResponse.json({ ok: true });
});
