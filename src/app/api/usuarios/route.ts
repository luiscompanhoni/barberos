import { NextResponse } from "next/server";
import { listarAcessos, salvarAcesso } from "@/lib/auth/equipe";
import { zCriarUsuario } from "@/lib/auth/equipe-schemas";
import { exigirSessao } from "@/lib/auth/sessao";
import { rota } from "@/lib/erros";
import { corpo } from "@/lib/validacao";

/** Somente o dono administra os cadastros de acesso. */
export const GET = rota(async () => {
  const s = await exigirSessao(["DONO"]);
  return NextResponse.json(await listarAcessos(s));
});

export const POST = rota(async (req: Request) => {
  const s = await exigirSessao(["DONO"]);
  return NextResponse.json(await salvarAcesso(s, null, await corpo(req, zCriarUsuario)), { status: 201 });
});
