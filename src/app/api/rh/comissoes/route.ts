import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirSessao } from "@/lib/auth/sessao";
import { rota } from "@/lib/erros";
import { configComissoes, salvarComissoes } from "@/lib/rh/comissoes";
import { corpo, zId } from "@/lib/validacao";

export const dynamic = "force-dynamic";

const zTipo = z.enum(["PERCENTUAL", "FIXO"]);
const zValor = z.number().int().min(0).max(10_000_000);
const zRegra = z.object({ servicoId: zId, avulsoTipo: zTipo, avulsoValor: zValor, planoTipo: zTipo, planoValor: zValor });

/** Regras de comissao por servico e excecoes por barbeiro. */
export const GET = rota(async () => {
  await exigirSessao(["DONO"]);
  return NextResponse.json(await configComissoes());
});

export const PUT = rota(async (req: Request) => {
  const s = await exigirSessao(["DONO"]);
  const b = await corpo(req, z.object({ gerais: z.array(zRegra).max(300), excecoes: z.array(zRegra.extend({ barbeiroId: zId })).max(1000) }));
  return NextResponse.json(await salvarComissoes(s, b));
});
