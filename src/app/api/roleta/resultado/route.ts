import { NextResponse } from "next/server";
import { exigirSessao } from "@/lib/auth/sessao";
import { rota } from "@/lib/erros";
import { resultadoRoleta } from "@/lib/roleta/servico";

export const dynamic = "force-dynamic";

/** Custo x faturamento da roleta no periodo (so o dono: tem valores da barbearia). */
export const GET = rota(async (req: Request) => {
  await exigirSessao(["DONO"]);
  return NextResponse.json(await resultadoRoleta(new URL(req.url).searchParams.get("periodo")));
});
