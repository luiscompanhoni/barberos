import { NextResponse } from "next/server";
import { BALCAO, exigirSessao } from "@/lib/auth/sessao";
import { rota } from "@/lib/erros";
import { zPedirEstorno } from "@/lib/estornos/schemas";
import { listarEstornos, pedirEstorno } from "@/lib/estornos/servico";
import { corpo } from "@/lib/validacao";

export const dynamic = "force-dynamic";

/** Pendentes (para o dono decidir) e o historico. */
export const GET = rota(async () => {
  const s = await exigirSessao(BALCAO);
  return NextResponse.json(await listarEstornos(s));
});

/** Recepcao pede (fica pendente); dono estorna direto. */
export const POST = rota(async (req: Request) => {
  const s = await exigirSessao(BALCAO);
  const b = await corpo(req, zPedirEstorno);
  return NextResponse.json({ estorno: await pedirEstorno(s, b) });
});
