import { NextResponse } from "next/server";
import { exigirSessao } from "@/lib/auth/sessao";
import { painelConfiguracaoAvaliacao, salvarConfiguracaoAvaliacao, schemaConfiguracaoAvaliacao } from "@/lib/avaliacoes/configuracao";
import { rota } from "@/lib/erros";
import { corpo } from "@/lib/validacao";

export const GET = rota(async () => NextResponse.json(await painelConfiguracaoAvaliacao(await exigirSessao(["DONO"]))));
export const PATCH = rota(async (req: Request) => {
  const s = await exigirSessao(["DONO"]);
  return NextResponse.json(await salvarConfiguracaoAvaliacao(s, await corpo(req, schemaConfiguracaoAvaliacao)));
});
