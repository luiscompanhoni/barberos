import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirSessao } from "@/lib/auth/sessao";
import { agendaDoPeriodo } from "@/lib/agenda/consultas";
import { rota } from "@/lib/erros";
import { parametros, zData, zId } from "@/lib/validacao";

export const GET = rota(async (req: Request) => {
  await exigirSessao();
  const q = parametros(
    req,
    z.object({ data: zData, dias: z.coerce.number().int().min(1).max(7).default(1), barbeiroId: zId.optional() }),
  );
  return NextResponse.json(await agendaDoPeriodo(q.data, q.dias, q.barbeiroId));
});
