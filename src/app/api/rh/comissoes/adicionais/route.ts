import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirSessaoCom } from "@/lib/auth/permissoes";
import { rota } from "@/lib/erros";
import { criarAdicional, listarAdicionais } from "@/lib/rh/adicionais";
import { corpo, zData, zId } from "@/lib/validacao";

export const dynamic = "force-dynamic";

/** Comissao diferenciada por barbeiro (so o dono: mexe em pagamento). */
export const GET = rota(async () => {
  await exigirSessaoCom("comissao", "folha");
  return NextResponse.json(await listarAdicionais());
});

export const POST = rota(async (req: Request) => {
  const s = await exigirSessaoCom("comissao");
  const b = await corpo(req, z.object({
    barbeiroId: zId,
    modalidade: z.enum(["ASSINATURA", "AVULSO"]),
    pontosBps: z.number().int().min(-10_000).max(10_000),
    motivo: z.string().max(300),
    inicio: zData,
    fim: zData.nullable(),
  }));
  await criarAdicional(s, b);
  return NextResponse.json(await listarAdicionais());
});
