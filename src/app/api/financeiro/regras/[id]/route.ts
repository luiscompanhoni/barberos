import { NextResponse } from "next/server";
import { exigirSessaoCom } from "@/lib/auth/permissoes";
import { excluirRegra } from "@/lib/conciliacao/stone";
import { rota } from "@/lib/erros";

/** Apaga uma regra (o que ja foi classificado por ela fica como esta). */
export const DELETE = rota(async (_req: Request, ctx: RouteContext<"/api/financeiro/regras/[id]">) => {
  const s = await exigirSessaoCom("resultado");
  const { id } = await ctx.params;
  await excluirRegra(s, id);
  return NextResponse.json({ ok: true });
});
