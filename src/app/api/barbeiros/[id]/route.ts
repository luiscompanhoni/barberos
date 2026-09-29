import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirSessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { rota } from "@/lib/erros";
import { publicar } from "@/lib/eventos";
import { corpo } from "@/lib/validacao";

export const PATCH = rota(async (req: Request, ctx: RouteContext<"/api/barbeiros/[id]">) => {
  await exigirSessao(["DONO"]);
  const { id } = await ctx.params;
  const b = await corpo(
    req,
    z.object({
      nome: z.string().trim().min(2).max(60).optional(),
      cor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      ordem: z.number().int().min(0).optional(),
      ativo: z.boolean().optional(),
    }),
  );
  const barbeiro = await db.barbeiro.update({ where: { id }, data: b });
  // Desativar o barbeiro tambem corta o acesso dele.
  if (b.ativo !== undefined) {
    await db.usuario.update({ where: { id: barbeiro.usuarioId }, data: { ativo: b.ativo } });
  }
  publicar({ tipo: "agenda", barbeiroIds: [id], datas: [] });
  return NextResponse.json(barbeiro);
});
