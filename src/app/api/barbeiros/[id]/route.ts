import { NextResponse } from "next/server";
import { z } from "zod";
import { auditarMudanca } from "@/lib/auditoria";
import { ativarBarbeiro } from "@/lib/auth/equipe";
import { GESTAO, exigirSessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { naoEncontrado, rota } from "@/lib/erros";
import { publicar } from "@/lib/eventos";
import { corpo } from "@/lib/validacao";

export const PATCH = rota(async (req: Request, ctx: RouteContext<"/api/barbeiros/[id]">) => {
  const sessao = await exigirSessao(GESTAO);
  const { id } = await ctx.params;
  const { ativo, ...dados } = await corpo(
    req,
    z.object({
      nome: z.string().trim().min(2).max(60).optional(),
      cor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      ordem: z.number().int().min(0).optional(),
      ativo: z.boolean().optional(),
    }),
  );
  // Ligar/desligar mexe no login da pessoa: só o dono, pelas regras de Acessos.
  if (ativo !== undefined) await ativarBarbeiro(sessao, id, ativo);
  const barbeiro = await db.$transaction(async (tx) => {
    const atual = await tx.barbeiro.findUnique({ where: { id } });
    if (!atual) throw naoEncontrado("Barbeiro");
    if (!Object.keys(dados).length) return atual;
    await auditarMudanca(tx, sessao.usuarioId, "alterar", "barbeiro", id, atual, dados, { barbeiro: atual.nome });
    return tx.barbeiro.update({ where: { id }, data: dados });
  });
  publicar({ tipo: "agenda", barbeiroIds: [id], datas: [] });
  return NextResponse.json(barbeiro);
});
