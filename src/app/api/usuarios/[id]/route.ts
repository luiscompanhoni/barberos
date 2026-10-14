import { NextResponse } from "next/server";
import { z } from "zod";
import { auditar } from "@/lib/auditoria";
import { definirSenhaTemporaria } from "@/lib/auth/acesso";
import { exigirSessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { ErroNegocio, rota } from "@/lib/erros";
import { corpo } from "@/lib/validacao";

/** Dono gera senha temporaria (mostrada uma vez), ativa/desativa o acesso ou muda o papel (recepcao, gerente, dono). */
export const PATCH = rota(async (req: Request, ctx: RouteContext<"/api/usuarios/[id]">) => {
  const s = await exigirSessao(["DONO"]);
  const { id } = await ctx.params;
  const b = await corpo(req, z.discriminatedUnion("acao", [
    z.object({ acao: z.enum(["senha_temporaria", "ativar", "desativar"]) }),
    z.object({ acao: z.literal("papel"), papel: z.enum(["RECEPCAO", "GERENTE", "DONO"]) }),
  ]));
  if (b.acao === "senha_temporaria") {
    const senha = await definirSenhaTemporaria(id);
    await db.$transaction((tx) => auditar(tx, s.usuarioId, "senha_temporaria", "usuario", id));
    return NextResponse.json({ senha });
  }
  if (id === s.usuarioId) throw new ErroNegocio(b.acao === "papel" ? "Você não pode mudar o próprio papel." : "Você não pode desativar o próprio acesso.");
  if (b.acao === "papel") {
    const papel = b.papel;
    await db.$transaction(async (tx) => {
      const u = await tx.usuario.findUniqueOrThrow({ where: { id }, select: { papel: true, nome: true } });
      // Barbeiro e cliente tem cadastro proprio: o papel deles nao muda por aqui.
      if (u.papel === "BARBEIRO" || u.papel === "CLIENTE") throw new ErroNegocio("O papel de barbeiro e de cliente não muda por aqui.", 409);
      if (u.papel === papel) return;
      await tx.usuario.update({ where: { id }, data: { papel } });
      await auditar(tx, s.usuarioId, "papel", "usuario", id, { usuario: u.nome, antes: { papel: u.papel }, depois: { papel } });
    });
    return NextResponse.json({ ok: true });
  }
  await db.$transaction(async (tx) => {
    const u = await tx.usuario.findUniqueOrThrow({ where: { id }, select: { ativo: true, nome: true } });
    await tx.usuario.update({ where: { id }, data: { ativo: b.acao === "ativar" } });
    await auditar(tx, s.usuarioId, b.acao, "usuario", id, { usuario: u.nome, antes: { ativo: u.ativo }, depois: { ativo: b.acao === "ativar" } });
  });
  return NextResponse.json({ ok: true });
});
