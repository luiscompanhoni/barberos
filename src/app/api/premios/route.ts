import { NextResponse } from "next/server";
import { BALCAO, exigirSessao } from "@/lib/auth/sessao";
import { rota } from "@/lib/erros";
import { buscarPremios } from "@/lib/jogos/premios";

export const dynamic = "force-dynamic";

/** Recepcao: premio pelo codigo, premios abertos de um cliente/comanda ou todos os abertos. */
export const GET = rota(async (req: Request) => {
  await exigirSessao(BALCAO);
  const q = new URL(req.url).searchParams;
  return NextResponse.json(await buscarPremios({ codigo: q.get("codigo") ?? undefined, clienteId: q.get("cliente") ?? undefined, comandaId: q.get("comanda") ?? undefined }));
});
