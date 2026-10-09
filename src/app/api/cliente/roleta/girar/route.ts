import { NextResponse } from "next/server";
import { exigirCliente } from "@/lib/auth/sessao";
import { rota } from "@/lib/erros";
import { girar } from "@/lib/roleta/servico";

/** Gira: o sorteio e feito no servidor; a tela anima ate o premio devolvido. */
export const POST = rota(async () => {
  const s = await exigirCliente();
  return NextResponse.json(await girar(s.clienteId), { status: 201 });
});
