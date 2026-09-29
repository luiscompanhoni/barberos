import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirSessao } from "@/lib/auth/sessao";
import { horariosDisponiveis } from "@/lib/agenda/consultas";
import { rota } from "@/lib/erros";
import { parametros, zData, zId } from "@/lib/validacao";

export const GET = rota(async (req: Request) => {
  await exigirSessao();
  const q = parametros(req, z.object({ data: zData, servicoId: zId, barbeiroId: zId.optional() }));
  return NextResponse.json(await horariosDisponiveis({ ...q, paraCliente: false }));
});
