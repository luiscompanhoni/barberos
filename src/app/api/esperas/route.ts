import { NextResponse } from "next/server";
import { exigirSessao } from "@/lib/auth/sessao";
import { esperasAtivas } from "@/lib/crescimento/espera";
import { rota } from "@/lib/erros";

/** Quem esta esperando vaga (a equipe ve e pode encaixar na mao). */
export const GET = rota(async () => {
  await exigirSessao();
  return NextResponse.json(await esperasAtivas());
});
