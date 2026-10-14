import { NextResponse } from "next/server";
import { BALCAO, exigirSessao } from "@/lib/auth/sessao";
import { rota } from "@/lib/erros";
import { jogadasRecentes } from "@/lib/jogos/painel";

export const dynamic = "force-dynamic";

/** Ultimas jogadas (com IP e aparelho), por jogo ou cliente. */
export const GET = rota(async (req: Request) => {
  await exigirSessao(BALCAO);
  const q = new URL(req.url).searchParams;
  return NextResponse.json(await jogadasRecentes({ jogoId: q.get("jogo") ?? undefined, clienteId: q.get("cliente") ?? undefined, limite: Number(q.get("limite")) || 50 }));
});
