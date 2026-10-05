import { NextResponse } from "next/server";
import { z } from "zod";
import { ativarComCartao } from "@/lib/assinaturas/cartao-pix";
import { ErroNegocio, rota } from "@/lib/erros";
import { corpo } from "@/lib/validacao";

/**
 * Recebe o TOKEN do cartao (gerado no navegador direto na Pagar.me) e ativa a
 * assinatura ou troca o cartao. O numero do cartao nunca chega aqui.
 * Publica: a pagina e acessada pelo link com codigo aleatorio da assinatura.
 */
// Limite simples contra teste de cartoes em massa: 5 tentativas por assinatura por hora.
const g = globalThis as unknown as { tentativasCartao?: Map<string, number[]> };
const tentativas = (g.tentativasCartao ??= new Map<string, number[]>());

export const POST = rota(async (req: Request) => {
  const b = await corpo(
    req,
    z.object({ assinatura: z.string().min(20).max(64), cartaoToken: z.string().regex(/^token_[A-Za-z0-9]+$/) }),
  );
  const agora = Date.now();
  const recentes = (tentativas.get(b.assinatura) ?? []).filter((t) => agora - t < 3_600_000);
  if (recentes.length >= 5) throw new ErroNegocio("Muitas tentativas. Aguarde uma hora ou fale com a barbearia.", 429);
  tentativas.set(b.assinatura, [...recentes, agora]);
  const r = await ativarComCartao(b.assinatura, b.cartaoToken);
  return NextResponse.json({ status: r.status });
});
