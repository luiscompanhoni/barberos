import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirSessao } from "@/lib/auth/sessao";
import { modoMaquininha } from "@/lib/comandas/maquininha";
import { abrirComanda, listarComandas } from "@/lib/comandas/servico";
import { rota } from "@/lib/erros";
import { corpo } from "@/lib/validacao";

/** Abertas + as fechadas nas ultimas 16 h (o turno de hoje). */
export const GET = rota(async () => {
  await exigirSessao();
  const comandas = await listarComandas(new Date(Date.now() - 16 * 3600_000));
  return NextResponse.json({ comandas, maquininha: modoMaquininha() });
});

export const POST = rota(async (req: Request) => {
  const s = await exigirSessao();
  const b = await corpo(
    req,
    z.object({
      clienteId: z.string().min(1).nullish(),
      nomeAvulso: z.string().trim().max(60).nullish(),
      agendamentoId: z.string().min(1).nullish(),
    }),
  );
  const r = await abrirComanda(s, b);
  return NextResponse.json(r, { status: r.nova ? 201 : 200 });
});
