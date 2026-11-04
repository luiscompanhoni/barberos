import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirSessaoCom } from "@/lib/auth/permissoes";
import { ErroNegocio, rota } from "@/lib/erros";
import { excluirLancamento, lancar } from "@/lib/rh/folha";
import { corpoCobrancaEquipe } from "@/lib/pagamentos/http-equipe";
import { parametros, zId } from "@/lib/validacao";

/** Adicional, bonus, vale (pode sair do caixa) ou desconto na folha do mes. */
export const POST = rota(async (req: Request) => {
  const s = await exigirSessaoCom("folha");
  const b = await corpoCobrancaEquipe(req, z.object({
    idempotencia: z.unknown().optional(),
    competencia: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    pessoaId: zId,
    tipo: z.enum(["ADICIONAL", "BONUS", "VALE", "DESCONTO"]),
    valorCentavos: z.number().int().min(1).max(100_000_000),
    descricao: z.string().trim().min(2).max(120),
    doCaixa: z.boolean().optional(),
  }));
  const chave = z.uuid().safeParse(b.idempotencia);
  if (!chave.success) throw new ErroNegocio("Atualize a página da folha antes de tentar um novo lançamento. A identificação desta tentativa está ausente ou inválida.", 400, "idempotencia_necessaria");
  const l = await lancar(s, { ...b, idempotencia: chave.data });
  return NextResponse.json({ id: l.id });
});

export const DELETE = rota(async (req: Request) => {
  const s = await exigirSessaoCom("folha");
  const { id } = parametros(req, z.object({ id: zId }));
  await excluirLancamento(s, id);
  return NextResponse.json({ ok: true });
});
