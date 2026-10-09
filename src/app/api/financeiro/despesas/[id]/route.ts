import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirSessao } from "@/lib/auth/sessao";
import { rota } from "@/lib/erros";
import { editarDespesa, estornarDespesa, excluirDespesa, pagarDespesa } from "@/lib/financeiro/despesas";
import { corpo } from "@/lib/validacao";
import { zDadosDespesa, zPagarDespesa } from "@/lib/financeiro/schemas";

export const dynamic = "force-dynamic";

/** Editar (pendente), pagar ou estornar o pagamento. */
export const PATCH = rota(async (req: Request, ctx: RouteContext<"/api/financeiro/despesas/[id]">) => {
  const s = await exigirSessao(["DONO", "RECEPCAO"]);
  const { id } = await ctx.params;
  const b = await corpo(req, z.discriminatedUnion("acao", [
    zDadosDespesa.extend({ acao: z.literal("editar") }),
    zPagarDespesa.extend({ acao: z.literal("pagar") }),
    z.object({ acao: z.literal("estornar") }),
  ]));
  if (b.acao === "editar") await editarDespesa(s, id, b);
  else if (b.acao === "pagar") return NextResponse.json(await pagarDespesa(s, id, b));
  else await estornarDespesa(s, id);
  return NextResponse.json({ ok: true });
});

/** Exclui (so pendente). */
export const DELETE = rota(async (_req: Request, ctx: RouteContext<"/api/financeiro/despesas/[id]">) => {
  const s = await exigirSessao(["DONO", "RECEPCAO"]);
  const { id } = await ctx.params;
  await excluirDespesa(s, id);
  return NextResponse.json({ ok: true });
});
