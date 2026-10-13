import { NextResponse } from "next/server";
import { exigirCliente } from "@/lib/auth/sessao";
import { painelDeIndicacao } from "@/lib/crescimento/indicacao";
import { rota } from "@/lib/erros";

/** Link "indique e ganhe", quantos vieram e os descontos disponiveis. */
export const GET = rota(async () => {
  const s = await exigirCliente();
  return NextResponse.json(await painelDeIndicacao(s.clienteId));
});
