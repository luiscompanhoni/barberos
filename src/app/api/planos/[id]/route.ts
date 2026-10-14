import { NextResponse } from "next/server";
import { auditarMudanca } from "@/lib/auditoria";
import { GESTAO, exigirSessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { rota } from "@/lib/erros";
import { corpo } from "@/lib/validacao";
import { schemaPlano } from "@/lib/assinaturas/schemas";

/**
 * Edita o plano. Preco novo vale para novas adesoes: quem ja assina mantem o
 * preco travado na assinatura.
 */
export const PATCH = rota(async (req: Request, ctx: RouteContext<"/api/planos/[id]">) => {
  const sessao = await exigirSessao(GESTAO);
  const { id } = await ctx.params;
  const { servicos, barbeiroIds, ...dados } = await corpo(req, schemaPlano.partial());
  const plano = await db.$transaction(async (tx) => {
    const atual = await tx.plano.findUniqueOrThrow({ where: { id } });
    await auditarMudanca(tx, sessao.usuarioId, "alterar", "plano", id, atual, dados, { plano: atual.nome });
    if (servicos) {
      await tx.planoServico.deleteMany({ where: { planoId: id } });
      await tx.planoServico.createMany({ data: servicos.map((s) => ({ ...s, planoId: id })) });
    }
    if (barbeiroIds) {
      await tx.planoBarbeiro.deleteMany({ where: { planoId: id } });
      await tx.planoBarbeiro.createMany({ data: barbeiroIds.map((barbeiroId) => ({ barbeiroId, planoId: id })) });
    }
    return tx.plano.update({ where: { id }, data: dados });
  });
  return NextResponse.json(plano);
});
