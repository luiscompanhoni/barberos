import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirSessao } from "@/lib/auth/sessao";
import { rota } from "@/lib/erros";
import { conciliacao, conferir, desfazerConferencia, salvarTaxas } from "@/lib/financeiro/conciliacao";
import { FORMAS_CONCILIACAO } from "@/lib/financeiro/regras";
import { corpo } from "@/lib/validacao";

export const dynamic = "force-dynamic";
const zData = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const zForma = z.enum(FORMAS_CONCILIACAO);

export const GET = rota(async (req: Request) => {
  await exigirSessao(["DONO", "RECEPCAO"]);
  const q = new URL(req.url).searchParams;
  const { de, ate } = z.object({ de: zData, ate: zData }).parse({ de: q.get("de"), ate: q.get("ate") });
  return NextResponse.json(await conciliacao(de, ate));
});

/** Conferir (valor que caiu na conta), desfazer, ou salvar taxas/prazos (so o dono). */
export const POST = rota(async (req: Request) => {
  const b = await corpo(req, z.discriminatedUnion("acao", [
    z.object({ acao: z.literal("conferir"), data: zData, forma: zForma, recebidoCentavos: z.number().int().min(0).max(100_000_000), observacao: z.string().trim().max(300).optional() }),
    z.object({ acao: z.literal("desfazer"), data: zData, forma: zForma }),
    z.object({ acao: z.literal("taxas"), taxas: z.array(z.object({ forma: zForma, taxaBps: z.number().int().min(0).max(2000), prazoDias: z.number().int().min(0).max(60) })) }),
  ]));
  const s = await exigirSessao(b.acao === "taxas" ? ["DONO"] : ["DONO", "RECEPCAO"]);
  if (b.acao === "conferir") return NextResponse.json(await conferir(s, b));
  if (b.acao === "desfazer") {
    await desfazerConferencia(s, b.data, b.forma);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json(await salvarTaxas(s, b.taxas));
});
