import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirSessao } from "@/lib/auth/sessao";
import { rota } from "@/lib/erros";
import { excluirLancamento, lancar } from "@/lib/rh/folha";
import { corpo, parametros, zId } from "@/lib/validacao";

/** Adicional, bonus, vale (pode sair do caixa) ou desconto na folha do mes. */
export const POST = rota(async (req: Request) => {
  const s = await exigirSessao(["DONO"]);
  const b = await corpo(req, z.object({
    competencia: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    pessoaId: zId,
    tipo: z.enum(["ADICIONAL", "BONUS", "VALE", "DESCONTO"]),
    valorCentavos: z.number().int().min(1).max(100_000_000),
    descricao: z.string().trim().min(2).max(120),
    doCaixa: z.boolean().optional(),
  }));
  const l = await lancar(s, b);
  return NextResponse.json({ id: l.id });
});

export const DELETE = rota(async (req: Request) => {
  const s = await exigirSessao(["DONO"]);
  const { id } = parametros(req, z.object({ id: zId }));
  await excluirLancamento(s, id);
  return NextResponse.json({ ok: true });
});
