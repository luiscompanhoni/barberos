import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirSessao } from "@/lib/auth/sessao";
import { configuracaoOperacional, salvarConfiguracaoOperacional } from "@/lib/agenda/configuracao-operacional";
import { rota } from "@/lib/erros";
import { corpo, zId } from "@/lib/validacao";

export const GET = rota(async () => {
  await exigirSessao(["DONO"]);
  return NextResponse.json(await configuracaoOperacional());
});
export const PATCH = rota(async (req: Request) => {
  const s = await exigirSessao(["DONO"]);
  const b = await corpo(req, z.discriminatedUnion("tipo", [
    z.object({ tipo: z.literal("cadeira"), barbeiroId: zId, cadeiraId: zId.nullable() }),
    z.object({ tipo: z.literal("minimo"), servicoId: zId, barbeiroId: zId.optional(), minutos: z.number().int().min(5).max(480).nullable() }),
  ]));
  return NextResponse.json(await salvarConfiguracaoOperacional(s, b));
});
