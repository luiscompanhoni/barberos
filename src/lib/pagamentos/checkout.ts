/**
 * Checkout do BarberOS (servidor): como o cartao e pago, limite de tentativas e o
 * roteamento dos pedidos avulsos que chegam pelo webhook da Pagar.me.
 */
import { z } from "zod";
import { db } from "@/lib/db";
import { ErroNegocio } from "@/lib/erros";
import type { ModoCartao } from "./checkout-regras";
import { provedorPagamento, type Provedor } from "./gateway";

/** Token gerado no navegador pela Pagar.me (o numero do cartao nunca chega aqui). */
export const zCartaoToken = z.string().regex(/^token_[A-Za-z0-9]+$/, "Cartão inválido.");

export function chavePublicaPagarme() {
  return process.env.PAGARME_PUBLIC_KEY?.trim() || null;
}

/** Como o checkout recebe cartao no provedor atual. */
export function modoCartaoCheckout(p: Provedor = provedorPagamento()): ModoCartao {
  if (p === "pagarme") return chavePublicaPagarme() ? "token" : "indisponivel";
  if (p === "simulado") return process.env.NODE_ENV === "production" ? "indisponivel" : "teste";
  return "hospedado";
}

/** O pagamento online usa o checkout do BarberOS (Pagar.me, ou o simulado nos testes). */
export function checkoutProprio(p: Provedor = provedorPagamento()) {
  return p === "pagarme" || (p === "simulado" && process.env.NODE_ENV !== "production");
}

// Limite simples contra teste de cartoes em massa: N tentativas por chave por hora.
const g = globalThis as unknown as { tentativasCheckout?: Map<string, number[]> };
const tentativas = (g.tentativasCheckout ??= new Map<string, number[]>());

export function limitarTentativas(chave: string, max = 5, janelaMs = 3_600_000) {
  const agora = Date.now();
  const recentes = (tentativas.get(chave) ?? []).filter((t) => agora - t < janelaMs);
  if (recentes.length >= max) throw new ErroNegocio("Muitas tentativas. Aguarde uma hora ou fale com a barbearia.", 429, "tentativas");
  tentativas.set(chave, [...recentes, agora]);
}

/**
 * Pedido avulso (horario pago antes ou link de pagamento) avisado pelo webhook:
 * atualiza na hora. Devolve true se o pedido era de um deles.
 */
export async function sincronizarPedidoOnline(pedidoId: string) {
  const ant = await db.pagamentoAntecipado.findUnique({ where: { gatewayId: pedidoId }, select: { id: true } });
  if (ant) {
    await (await import("@/lib/agenda/antecipado")).sincronizarAntecipado(ant.id);
    return true;
  }
  const link = await db.linkPagamento.findUnique({ where: { gatewayId: pedidoId }, select: { id: true } });
  if (link) {
    await (await import("@/lib/links/servico")).sincronizarLink(link.id);
    return true;
  }
  return false;
}
