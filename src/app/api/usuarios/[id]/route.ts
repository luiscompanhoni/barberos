import { NextResponse } from "next/server";
import { z } from "zod";
import { auditar } from "@/lib/auditoria";
import { definirSenhaTemporaria } from "@/lib/auth/acesso";
import { exigirSessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { ErroNegocio, rota } from "@/lib/erros";
import { corpo } from "@/lib/validacao";

/** Dono gera senha temporaria (mostrada uma vez) ou ativa/desativa o acesso. */
export const PATCH = rota(async (req: Request, ctx: RouteContext<"/api/usuarios/[id]">) => {
  const s = await exigirSessao(["DONO"]);
  const { id } = await ctx.params;
  const b = await corpo(req, z.object({ acao: z.enum(["senha_temporaria", "ativar", "desativar"]) }));
  if (b.acao === "senha_temporaria") {
    const senha = await definirSenhaTemporaria(id);
    await db.$transaction((tx) => auditar(tx, s.usuarioId, "senha_temporaria", "usuario", id));
    return NextResponse.json({ senha });
  }
  if (id === s.usuarioId) throw new ErroNegocio("Você não pode desativar o próprio acesso.");
  await db.$transaction(async (tx) => {
    const u = await tx.usuario.findUniqueOrThrow({ where: { id }, select: { ativo: true, nome: true } });
    await tx.usuario.update({ where: { id }, data: { ativo: b.acao === "ativar" } });
    await auditar(tx, s.usuarioId, b.acao, "usuario", id, { usuario: u.nome, antes: { ativo: u.ativo }, depois: { ativo: b.acao === "ativar" } });
  });
  return NextResponse.json({ ok: true });
});
