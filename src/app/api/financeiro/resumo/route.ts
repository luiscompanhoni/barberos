import { NextResponse } from "next/server";
import { exigirSessao } from "@/lib/auth/sessao";
import { rota } from "@/lib/erros";
import { resumoMes } from "@/lib/financeiro/resumo";
import { zMes } from "@/lib/financeiro/schemas";

export const dynamic = "force-dynamic";

/** Resumo do mes (?mes=AAAA-MM): so o dono ve o resultado. */
export const GET = rota(async (req: Request) => {
  await exigirSessao(["DONO"]);
  const mes = zMes.parse(new URL(req.url).searchParams.get("mes"));
  return NextResponse.json(await resumoMes(mes));
});
