import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirPermissao } from "@/lib/auth/permissoes";
import { BALCAO, exigirSessao } from "@/lib/auth/sessao";
import { rota } from "@/lib/erros";
import { abrirCaixa, fecharCaixa, movimentarCaixa, painelCaixa } from "@/lib/financeiro/caixa";
import { corpo } from "@/lib/validacao";

export const dynamic = "force-dynamic";

/** Caixa aberto (resumo ao vivo) e os ultimos fechamentos. */
export const GET = rota(async () => {
  await exigirSessao(BALCAO);
  return NextResponse.json(await painelCaixa());
});

const zValor = z.number().int().min(0).max(10_000_000);

/** Abrir, sangria, suprimento ou fechar. */
export const POST = rota(async (req: Request) => {
  const s = await exigirSessao(BALCAO);
  await exigirPermissao(s, "caixa");
  const b = await corpo(req, z.discriminatedUnion("acao", [
    z.object({ acao: z.literal("abrir"), fundoCentavos: zValor }),
    z.object({ acao: z.literal("sangria"), valorCentavos: zValor.min(1), motivo: z.string().trim().min(2).max(200) }),
    z.object({ acao: z.literal("suprimento"), valorCentavos: zValor.min(1), motivo: z.string().trim().min(2).max(200) }),
    z.object({ acao: z.literal("fechar"), contadoCentavos: zValor, observacao: z.string().trim().max(500).optional() }),
  ]));
  if (b.acao === "abrir") await abrirCaixa(s, b.fundoCentavos);
  else if (b.acao === "fechar") return NextResponse.json(await fecharCaixa(s, b.contadoCentavos, b.observacao));
  else await movimentarCaixa(s, b.acao === "sangria" ? "SANGRIA" : "SUPRIMENTO", b.valorCentavos, b.motivo);
  return NextResponse.json(await painelCaixa());
});
