import { NextResponse } from "next/server";
import { exigirCliente } from "@/lib/auth/sessao";
import { rota } from "@/lib/erros";
import { premiosDoCliente, premiosParaReservar } from "@/lib/jogos/premios";

export const dynamic = "force-dynamic";

/** Meus premios (todos) ou, com ?reservar=1, os que da para usar num agendamento. */
export const GET = rota(async (req: Request) => {
  const s = await exigirCliente();
  const reservar = new URL(req.url).searchParams.get("reservar") === "1";
  return NextResponse.json(reservar ? await premiosParaReservar(s.clienteId) : await premiosDoCliente(s.clienteId));
});
