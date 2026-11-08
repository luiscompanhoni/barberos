import { NextResponse } from "next/server";
import { z } from "zod";
import { redefinirSenhaTemporaria } from "@/lib/auth/acesso";
import { abrirSessao } from "@/lib/auth/abrir-sessao";
import { opcoesDeAcesso, salvarAcesso } from "@/lib/auth/equipe";
import { zEditarUsuario, zPapelEquipe } from "@/lib/auth/equipe-schemas";
import { exigirSessao } from "@/lib/auth/sessao";
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
    const r = await redefinirSenhaTemporaria(id, s);
    if (id === s.usuarioId) await abrirSessao(r.usuario);
    return NextResponse.json({ senha: r.senha }, { headers: { "Cache-Control": "private, no-store" } });
  }
  if (b.acao === "editar") {
    const dados = zEditarUsuario.strip().parse(b);
    return NextResponse.json(await salvarAcesso(s, id, dados));
  }
  return NextResponse.json(await salvarAcesso(s, id, b.acao === "papel" ? { papel: b.papel } : { ativo: b.acao === "ativar" }));
});
