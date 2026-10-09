import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirSessao } from "@/lib/auth/sessao";
import { avaliarItem } from "@/lib/checklist/pontos";
import { rota } from "@/lib/erros";
import { corpo } from "@/lib/validacao";

/** Gerente valida a tarefa (ganha pontos), da re (perde pontos) ou desfaz (null). */
export const POST = rota(async (req: Request) => {
  const s = await exigirSessao(["DONO", "RECEPCAO"]);
  const b = await corpo(req, z.object({
    itemId: z.string().max(40),
    avaliacao: z.enum(["VALIDADO", "RE"]).nullable(),
    motivo: z.string().trim().max(200).nullish(),
  }));
  return NextResponse.json(await avaliarItem(s, b.itemId, b.avaliacao, b.motivo || null));
});
