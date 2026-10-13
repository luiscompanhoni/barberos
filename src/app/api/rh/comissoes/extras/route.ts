import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirSessao } from "@/lib/auth/sessao";
import { rota } from "@/lib/erros";
import { configExtras, salvarExtras } from "@/lib/rh/pote";
import { corpo, zId } from "@/lib/validacao";

export const dynamic = "force-dynamic";

const zPct = z.number().int().min(0).max(10_000);

/** Pote de assinaturas e faixas de comissao de produtos (so o dono). */
export const GET = rota(async () => {
  await exigirSessao(["DONO"]);
  return NextResponse.json(await configExtras());
});

export const PUT = rota(async (req: Request) => {
  const s = await exigirSessao(["DONO"]);
  const b = await corpo(req, z.object({
    pote: z.object({
      ativo: z.boolean(),
      percentualBps: zPct,
      fichas: z.array(z.object({ servicoId: zId, fichas: z.number().int().min(0).max(1000) })).max(300),
      ajustes: z.array(z.object({ barbeiroId: zId, adicionalBps: zPct, diferenciadaBps: zPct.nullable() })).max(100),
    }),
    faixas: z.array(z.object({ categoria: z.enum(["BAR", "LOJA"]), minimoCentavos: z.number().int().min(0).max(100_000_000), percentualBps: zPct })).max(50),
  }));
  return NextResponse.json(await salvarExtras(s, b));
});
