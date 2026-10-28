import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirSessao } from "@/lib/auth/sessao";
import { listarCadeiras, salvarCadeira } from "@/lib/agenda/cadeiras";
import { rota } from "@/lib/erros";
import { corpo, zId } from "@/lib/validacao";

export const GET = rota(async () => {
  await exigirSessao();
  return NextResponse.json(await listarCadeiras());
});
export const POST = rota(async (req: Request) => {
  const s = await exigirSessao(["DONO"]);
  const b = await corpo(req, z.object({ id: zId.optional(), nome: z.string().trim().min(1).max(60), ativa: z.boolean().default(true) }));
  return NextResponse.json(await salvarCadeira(s, b));
});
