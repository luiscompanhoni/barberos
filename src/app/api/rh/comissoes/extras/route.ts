import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirSessaoCom } from "@/lib/auth/permissoes";
import { rota } from "@/lib/erros";
import { configExtras, salvarExtras } from "@/lib/rh/pote";
import { corpo, zId } from "@/lib/validacao";

export const dynamic = "force-dynamic";

const zPct = z.number().int().min(0).max(10_000);

/** Comissao das assinaturas, comissao diferenciada e faixas de comissao de produtos (so o dono). */
export const GET = rota(async () => {
  await exigirSessaoCom("comissao", "folha");
  return NextResponse.json(await configExtras());
});

export const PUT = rota(async (req: Request) => {
  const s = await exigirSessaoCom("comissao");
  const b = await corpo(req, z.object({
    assinaturas: z.object({
      ativo: z.boolean(),
      percentualBps: zPct,
      creditos: z.array(z.object({ servicoId: zId, creditos: z.number().int().min(0).max(1000) })).max(300),
    }),
    faixas: z.array(z.object({ categoria: z.enum(["BAR", "LOJA"]), minimoCentavos: z.number().int().min(0).max(100_000_000), percentualBps: zPct })).max(50),
  }));
  return NextResponse.json(await salvarExtras(s, b));
});
