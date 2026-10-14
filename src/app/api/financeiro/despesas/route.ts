import { NextResponse } from "next/server";
import { BALCAO, exigirSessao } from "@/lib/auth/sessao";
import { rota } from "@/lib/erros";
import { criarDespesa, listarDespesas } from "@/lib/financeiro/despesas";
import { corpo } from "@/lib/validacao";
import { zDadosDespesa, zMes } from "@/lib/financeiro/schemas";

export const dynamic = "force-dynamic";

/** Pendentes + pagas no mes (?mes=AAAA-MM), com os totais. */
export const GET = rota(async (req: Request) => {
  await exigirSessao(BALCAO);
  const mes = zMes.parse(new URL(req.url).searchParams.get("mes"));
  return NextResponse.json(await listarDespesas(mes));
});

export const POST = rota(async (req: Request) => {
  const s = await exigirSessao(BALCAO);
  const b = await corpo(req, zDadosDespesa);
  return NextResponse.json(await criarDespesa(s, b), { status: 201 });
});
