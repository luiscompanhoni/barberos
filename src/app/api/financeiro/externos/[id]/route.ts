import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirSessaoCom } from "@/lib/auth/permissoes";
import { classificarMovimento } from "@/lib/conciliacao/resultado";
import { rota } from "@/lib/erros";
import { corpo } from "@/lib/validacao";

/** Corrige o tipo/categoria de um movimento do extrato (ex.: Pix para o barbeiro = FOLHA). */
export const PATCH = rota(async (req: Request, ctx: RouteContext<"/api/financeiro/externos/[id]">) => {
  const s = await exigirSessaoCom("resultado");
  const { id } = await ctx.params;
  const b = await corpo(req, z.object({
    tipo: z.enum(["RECEBIMENTO", "TAXA", "ANTECIPACAO", "ESTORNO", "TRANSFERENCIA", "PAGAMENTO", "TARIFA", "OUTRO"]),
    categoria: z.string().trim().max(30).nullable(),
    observacao: z.string().trim().max(200).nullable().optional(),
  }));
  await classificarMovimento(s, id, b);
  return NextResponse.json({ ok: true });
});
