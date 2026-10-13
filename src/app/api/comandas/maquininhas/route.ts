import { NextResponse } from "next/server";
import { exigirSessao } from "@/lib/auth/sessao";
import { maquininhas, modoMaquininha } from "@/lib/comandas/maquininha";
import { rota } from "@/lib/erros";

export const dynamic = "force-dynamic";

/** Maquininhas integradas (para a recepcao escolher em qual o valor aparece). */
export const GET = rota(async () => {
  await exigirSessao();
  return NextResponse.json({ modo: modoMaquininha(), maquininhas: modoMaquininha() === "stone" ? maquininhas() : [] });
});
