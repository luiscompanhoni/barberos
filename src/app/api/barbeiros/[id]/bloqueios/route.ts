import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirSessao } from "@/lib/auth/sessao";
import { fecharAgenda } from "@/lib/agenda/expediente";
import { rota } from "@/lib/erros";
import { corpo, zId, zInstante } from "@/lib/validacao";

/**
 * Fechar agenda. Primeiro chame com `confirmar: false` para ver os clientes
 * afetados; depois com `confirmar: true` e uma resolucao para cada um.
 */
export const POST = rota(async (req: Request, ctx: RouteContext<"/api/barbeiros/[id]/bloqueios">) => {
  const s = await exigirSessao();
  const { id } = await ctx.params;
  const b = await corpo(
    req,
    z.object({
      inicio: zInstante,
      fim: zInstante,
      motivo: z.string().trim().max(120).optional(),
      confirmar: z.boolean().default(false),
      resolucoes: z
        .array(
          z.discriminatedUnion("acao", [
            z.object({ agendamentoId: zId, acao: z.literal("cancelar") }),
            z.object({ agendamentoId: zId, acao: z.literal("transferir"), barbeiroDestinoId: zId }),
          ]),
        )
        .optional(),
    }),
  );
  const r = await fecharAgenda(id, b, s);
  return NextResponse.json(r, { status: r.criado ? 201 : 200 });
});
