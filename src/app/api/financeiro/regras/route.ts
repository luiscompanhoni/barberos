import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirSessaoCom } from "@/lib/auth/permissoes";
import { listarRegras, salvarRegra } from "@/lib/conciliacao/stone";
import { rota } from "@/lib/erros";
import { corpo } from "@/lib/validacao";

export const dynamic = "force-dynamic";

/** Regras de classificacao por nome (destino/origem) da conciliacao. */
export const GET = rota(async () => {
  await exigirSessaoCom("resultado");
  return NextResponse.json(await listarRegras());
});

export const POST = rota(async (req: Request) => {
  const s = await exigirSessaoCom("resultado");
  const b = await corpo(req, z.object({
    padrao: z.string().trim().min(3).max(80),
    tipo: z.enum(["RECEBIMENTO", "TAXA", "ANTECIPACAO", "ESTORNO", "TRANSFERENCIA", "PAGAMENTO", "TARIFA", "OUTRO"]),
    categoria: z.string().trim().max(30).nullable(),
  }));
  return NextResponse.json({ aplicadas: await salvarRegra(s, b) });
});
