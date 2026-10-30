import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirSessao } from "@/lib/auth/sessao";
import { encaixesDoDia } from "@/lib/agenda/encaixes";
import { rota } from "@/lib/erros";
import { parametros, zData, zId } from "@/lib/validacao";

export const GET = rota(async (req: Request) => {
  const s = await exigirSessao();
  const q = parametros(req, z.object({ data: zData, barbeiroId: zId.optional(), servicoId: zId.optional() }));
  return NextResponse.json(await encaixesDoDia(q, s));
});
