import { NextResponse } from "next/server";
import { exigirSessao } from "@/lib/auth/sessao";
import { relatorioEstoque } from "@/lib/comandas/relatorio";
import { rota } from "@/lib/erros";

export const GET = rota(async () => {
  await exigirSessao(["DONO", "RECEPCAO"]);
  return NextResponse.json(await relatorioEstoque());
});
