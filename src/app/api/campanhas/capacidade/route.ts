import { NextResponse } from "next/server";
import { exigirSessao, GESTAO } from "@/lib/auth/sessao";
import { capacidadeDaAgenda } from "@/lib/campanhas/capacidade";
import { rota } from "@/lib/erros";

export const dynamic = "force-dynamic";

/** Horarios livres nos proximos 3, 7 e 14 dias, por barbeiro, e quantos atendimentos ainda cabem. */
export const GET = rota(async () => {
  await exigirSessao(GESTAO);
  return NextResponse.json(await capacidadeDaAgenda());
});
