import { NextResponse } from "next/server";
import { exigirSessao } from "@/lib/auth/sessao";
import { reenviarConvitesSemSaida } from "@/lib/avaliacoes/reenvio";
import { rota } from "@/lib/erros";
import { limitar } from "@/lib/limite";

export const POST = rota(async () => {
  const s = await exigirSessao(["DONO"]);
  limitar(`avaliacoes-reenvio:${s.usuarioId}`, 1, 60_000);
  return NextResponse.json(await reenviarConvitesSemSaida(s));
});
