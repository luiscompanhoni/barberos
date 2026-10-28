import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirSessao } from "@/lib/auth/sessao";
import { corpo, zId } from "@/lib/validacao";
import { rota } from "@/lib/erros";
import { reconciliarAviso } from "@/lib/recompras/avisos";
export const POST = rota(async (req: Request) => {
  const s = await exigirSessao(["DONO"]);
  const b = await corpo(req, z.object({ id: zId, estado: z.enum(["ENVIADO", "CANCELADO"]), motivo: z.string().trim().min(5).max(250) }));
  return NextResponse.json(await reconciliarAviso(s, b));
});
