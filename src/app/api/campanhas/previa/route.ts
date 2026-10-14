import { NextResponse } from "next/server";
import { exigirSessao, GESTAO } from "@/lib/auth/sessao";
import { previa } from "@/lib/campanhas/servico";
import { rota } from "@/lib/erros";

export const dynamic = "force-dynamic";

/** Quantos clientes uma campanha com esses segmentos chamaria agora (`?segmentos=ate30,d31a60`). */
export const GET = rota(async (req: Request) => {
  await exigirSessao(GESTAO);
  const segmentos = (new URL(req.url).searchParams.get("segmentos") ?? "").split(",").filter(Boolean).slice(0, 10);
  return NextResponse.json(await previa(segmentos));
});
