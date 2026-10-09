import { NextResponse } from "next/server";
import { exigirSessao } from "@/lib/auth/sessao";
import { modoMaquininha } from "@/lib/comandas/maquininha";
import { schemaAcaoComanda } from "@/lib/comandas/schemas";
import { adicionarAvulso, adicionarProduto, cancelarComanda, definirDesconto, detalheComanda, fecharComanda } from "@/lib/comandas/servico";
import { usarSaldo } from "@/lib/crescimento/saldo";
import { rota } from "@/lib/erros";
import { corpo } from "@/lib/validacao";

export const GET = rota(async (_req: Request, ctx: RouteContext<"/api/comandas/[id]">) => {
  await exigirSessao();
  const { id } = await ctx.params;
  return NextResponse.json({ comanda: await detalheComanda(id), maquininha: modoMaquininha() });
});

/** Acoes na comanda: lancar produto/avulso, desconto, fechar, cancelar. */
export const PATCH = rota(async (req: Request, ctx: RouteContext<"/api/comandas/[id]">) => {
  const s = await exigirSessao();
  const { id } = await ctx.params;
  const b = await corpo(req, schemaAcaoComanda);
  let extra: unknown = null;
  switch (b.acao) {
    case "produto":
      await adicionarProduto(s, id, b.produtoId, b.quantidade);
      break;
    case "avulso":
      await adicionarAvulso(s, id, b.descricao, b.precoCentavos, b.quantidade);
      break;
    case "desconto":
      await definirDesconto(s, id, b.descontoCentavos);
      break;
    case "fechar":
      extra = await fecharComanda(s, id);
      break;
    case "saldo":
      await usarSaldo(s, id); // resultado so e usado no "fechar"
      break;
    case "cancelar":
      await cancelarComanda(s, id, b.motivo);
      break;
  }
  return NextResponse.json({ comanda: await detalheComanda(id), resultado: extra });
});
