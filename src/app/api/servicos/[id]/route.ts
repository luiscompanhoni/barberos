import { NextResponse } from "next/server";
import { z } from "zod";
import { auditarMudanca } from "@/lib/auditoria";
import { GESTAO, exigirSessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { rota } from "@/lib/erros";
import { corpo } from "@/lib/validacao";

export const PATCH = rota(async (req: Request, ctx: RouteContext<"/api/servicos/[id]">) => {
  const sessao = await exigirSessao(GESTAO);
  const { id } = await ctx.params;
  const b = await corpo(
    req,
    z.object({
      nome: z.string().trim().min(2).max(60).optional(),
      duracaoMin: z.number().int().min(5).max(480).optional(),
      precoCentavos: z.number().int().min(0).max(10_000_00).optional(),
      ativo: z.boolean().optional(),
      barbeiroIds: z.array(z.string()).optional(),
    }),
  );
  const { barbeiroIds, ...dados } = b;
  const s = await db.$transaction(async (tx) => {
    const atual = await tx.servico.findUniqueOrThrow({ where: { id } });
    if (barbeiroIds) {
      await tx.barbeiroServico.deleteMany({ where: { servicoId: id, barbeiroId: { notIn: barbeiroIds } } });
      await tx.barbeiroServico.createMany({
        data: barbeiroIds.map((barbeiroId) => ({ barbeiroId, servicoId: id })),
        skipDuplicates: true,
      });
    }
    await auditarMudanca(tx, sessao.usuarioId, "alterar", "servico", id, atual, dados, { servico: atual.nome });
    return tx.servico.update({ where: { id }, data: dados });
  });
  return NextResponse.json(s);
});
