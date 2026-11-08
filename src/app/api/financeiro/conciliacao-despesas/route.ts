import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirSessao } from "@/lib/auth/sessao";
import { anularVinculoDespesa, confirmarDespesasDistintas, vincularDespesaExterna } from "@/lib/conciliacao/despesas-vinculos";
import { conferirExtratoMes } from "@/lib/conciliacao/despesas-conferencia";
import { rota } from "@/lib/erros";
import { zMes } from "@/lib/financeiro/schemas";
import { corpo } from "@/lib/validacao";

const motivo = z.string().trim().min(5).max(500);
const entrada = z.discriminatedUnion("acao", [
  z.object({ acao: z.literal("VINCULAR"), movimentoId: z.string().min(1).max(80), despesaId: z.string().min(1).max(80), motivo }).strict(),
  z.object({ acao: z.literal("DISTINTOS"), movimentoId: z.string().min(1).max(80), despesaId: z.string().min(1).max(80), motivo }).strict(),
  z.object({ acao: z.literal("ANULAR"), vinculoId: z.string().min(1).max(80), motivo }).strict(),
  z.object({ acao: z.literal("CONFERIR"), mes: zMes, fonte: z.enum(["CELCASH", "STONE"]), hashDados: z.string().regex(/^[a-f0-9]{64}$/), mesCompleto: z.literal(true), motivo }).strict(),
]);

/** Somente o dono confirma vínculos e cobertura. Nenhuma ação cria pagamento ou modifica valores. */
export const POST = rota(async (req: Request) => {
  const s = await exigirSessao(["DONO"]);
  const b = await corpo(req, entrada);
  if (b.acao === "VINCULAR") return NextResponse.json(await vincularDespesaExterna(s, b.movimentoId, b.despesaId, b.motivo));
  if (b.acao === "ANULAR") return NextResponse.json(await anularVinculoDespesa(s, b.vinculoId, b.motivo));
  if (b.acao === "DISTINTOS") return NextResponse.json(await confirmarDespesasDistintas(s, b.movimentoId, b.despesaId, b.motivo));
  return NextResponse.json(await conferirExtratoMes(s, b.mes, b.fonte, b.hashDados, b.motivo));
});
