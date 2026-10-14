import { NextResponse } from "next/server";
import { BALCAO, exigirSessao } from "@/lib/auth/sessao";
import { relatorioEstoque } from "@/lib/comandas/relatorio";
import { rota } from "@/lib/erros";

export const GET = rota(async () => {
  await exigirSessao(BALCAO);
  return NextResponse.json(await relatorioEstoque());
});
