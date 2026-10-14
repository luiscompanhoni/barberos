import { NextResponse } from "next/server";
import { BALCAO, exigirSessao } from "@/lib/auth/sessao";
import { rota } from "@/lib/erros";
import { painelJogos } from "@/lib/jogos/painel";

export const dynamic = "force-dynamic";

/** Jogos com os premios, chances e o que saiu no mes (dono/gerente configuram; recepcao consulta). */
export const GET = rota(async () => {
  await exigirSessao(BALCAO);
  return NextResponse.json(await painelJogos());
});
