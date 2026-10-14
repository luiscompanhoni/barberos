import { NextResponse } from "next/server";
import { exigirSessaoCom } from "@/lib/auth/permissoes";
import { rota } from "@/lib/erros";
import { resultadoJogos } from "@/lib/jogos/painel";

export const dynamic = "force-dynamic";

/** Custo x faturamento dos jogos no periodo (so quem ve resultado: tem valores da barbearia). */
export const GET = rota(async (req: Request) => {
  await exigirSessaoCom("resultado");
  const q = new URL(req.url).searchParams;
  return NextResponse.json(await resultadoJogos(q.get("periodo"), q.get("jogo") ?? undefined));
});
