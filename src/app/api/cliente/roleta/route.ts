import { NextResponse } from "next/server";
import { exigirCliente } from "@/lib/auth/sessao";
import { rota } from "@/lib/erros";
import { estadoDoCliente } from "@/lib/roleta/servico";

export const dynamic = "force-dynamic";

/** Roda, giros disponiveis, bonus e premios do cliente. */
export const GET = rota(async () => {
  const s = await exigirCliente();
  return NextResponse.json(await estadoDoCliente(s.clienteId));
});
