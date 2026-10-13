import { NextResponse } from "next/server";
import { z } from "zod";
import { ativarComCartao } from "@/lib/assinaturas/cartao-pix";
import { rota } from "@/lib/erros";
import { limitarTentativas, zCartaoToken } from "@/lib/pagamentos/checkout";
import { corpo } from "@/lib/validacao";

/**
 * Recebe o TOKEN do cartao (gerado no navegador direto na Pagar.me) e ativa a
 * assinatura ou troca o cartao. O numero do cartao nunca chega aqui.
 * Publica: a pagina e acessada pelo link com codigo aleatorio da assinatura.
 * (O checkout novo usa /api/pagamentos/assinatura/[token]; esta rota segue para links antigos.)
 */
export const POST = rota(async (req: Request) => {
  const b = await corpo(req, z.object({ assinatura: z.string().min(20).max(64), cartaoToken: zCartaoToken }));
  // Limite contra teste de cartoes em massa: 5 tentativas por assinatura por hora.
  limitarTentativas(`assinatura:${b.assinatura}:CARTAO`);
  const r = await ativarComCartao(b.assinatura, b.cartaoToken);
  return NextResponse.json({ status: r.status });
});
