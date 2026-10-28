import { NextResponse } from "next/server";
import { z } from "zod";
import { auditar } from "@/lib/auditoria";
import { definirSenhaTemporaria } from "@/lib/auth/acesso";
import { opcoesDeAcesso, salvarAcesso } from "@/lib/auth/equipe";
import { zEditarUsuario, zPapelEquipe } from "@/lib/auth/equipe-schemas";
import { exigirSessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { rota } from "@/lib/erros";
import { corpo } from "@/lib/validacao";

export const GET = rota(async (_req: Request, ctx: RouteContext<"/api/usuarios/[id]">) => {
  const s = await exigirSessao(["DONO"]);
  return NextResponse.json(await opcoesDeAcesso(s, (await ctx.params).id));
});

const schema = z.discriminatedUnion("acao", [
  z.object({ acao: z.enum(["senha_temporaria", "ativar", "desativar"]) }),
  z.object({ acao: z.literal("papel"), papel: zPapelEquipe }),
  zEditarUsuario.extend({ acao: z.literal("editar") }),
]);

/** Edição completa preserva o vínculo com agenda, RH e histórico. */
export const PATCH = rota(async (req: Request, ctx: RouteContext<"/api/usuarios/[id]">) => {
  const s = await exigirSessao(["DONO"]);
  const { id } = await ctx.params;
  const b = await corpo(req, schema);
  if (b.acao === "senha_temporaria") {
    const senha = await definirSenhaTemporaria(id);
    await db.$transaction((tx) => auditar(tx, s.usuarioId, "senha_temporaria", "usuario", id));
    return NextResponse.json({ senha });
  }
  if (b.acao === "editar") {
    const dados = zEditarUsuario.strip().parse(b);
    return NextResponse.json(await salvarAcesso(s, id, dados));
  }
  return NextResponse.json(await salvarAcesso(s, id, b.acao === "papel" ? { papel: b.papel } : { ativo: b.acao === "ativar" }));
});
