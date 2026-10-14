import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirSessaoCom } from "@/lib/auth/permissoes";
import { rota } from "@/lib/erros";
import { listarFuncionarios, salvarFicha } from "@/lib/rh/funcionarios";
import { corpo, zData, zId } from "@/lib/validacao";

export const dynamic = "force-dynamic";

/** Fichas dos funcionarios (so o dono: tem salario e Pix). */
export const GET = rota(async () => {
  await exigirSessaoCom("folha");
  return NextResponse.json(await listarFuncionarios());
});

export const PATCH = rota(async (req: Request) => {
  const s = await exigirSessaoCom("folha");
  const b = await corpo(req, z.object({
    id: zId,
    cargo: z.string().trim().max(60).nullable(),
    salarioCentavos: z.number().int().min(0).max(100_000_000),
    chavePix: z.string().trim().max(120).nullable(),
    admissao: zData.nullable(),
    barbeiroId: zId.nullable(),
  }));
  const { id, ...ficha } = b;
  await salvarFicha(s, id, ficha);
  return NextResponse.json(await listarFuncionarios());
});
