import { NextResponse } from "next/server";
import { exigirCliente } from "@/lib/auth/sessao";
import { rota } from "@/lib/erros";
import { centralDoCliente } from "@/lib/jogos/motor";

export const dynamic = "force-dynamic";

/** Central de jogos: jogos no ar, jogadas disponiveis, vitrine e jogada pendente de revelar. */
export const GET = rota(async () => {
  const s = await exigirCliente();
  return NextResponse.json(await centralDoCliente(s.clienteId));
});
