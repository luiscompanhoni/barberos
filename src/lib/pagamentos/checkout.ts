/**
 * Checkout do BarberOS (servidor): como o cartao e pago, limite de tentativas e o
 * roteamento dos pedidos avulsos que chegam pelo webhook da Pagar.me.
 */
import { z } from "zod";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { ErroNegocio } from "@/lib/erros";
import type { ModoCartao } from "./checkout-regras";
import { provedorPagamento, type Provedor } from "./gateway";

/** Token gerado no navegador pela Pagar.me (o numero do cartao nunca chega aqui). */
export const zCartaoToken = z.string().max(512).regex(/^token_[A-Za-z0-9]+$/, "Cartão inválido.");

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
const g = globalThis as unknown as { tentativasCheckout?: Map<string, number[]>; expiracoesCheckout?: Map<string, number>;
  limpezaCheckout?: { ultima: number; proximaExpiracao: number } };
const tentativas = (g.tentativasCheckout ??= new Map<string, number[]>());
const expiracoes = (g.expiracoesCheckout ??= new Map<string, number>());
const JANELA_MAXIMA = 3_600_000;
const MAX_CHAVES = 10_000;
const limpeza = (g.limpezaCheckout ??= { ultima: 0, proximaExpiracao: Number.POSITIVE_INFINITY });

export function limitarTentativas(chave: string, max = 5, janelaMs = 3_600_000) {
  const agora = Date.now();
  if (!chave || chave.length > 256) throw new ErroNegocio("Identificador de pagamento inválido.", 400);
  // Expira inclusive chaves nunca mais consultadas; saturação não apaga limites ainda ativos.
  // Sob saturação, não percorre dez mil chaves a cada tentativa recusada.
  // Só há espaço recuperável quando alguma chave pode ter expirado.
  if (agora - limpeza.ultima >= 60_000 || (tentativas.size >= MAX_CHAVES && agora >= limpeza.proximaExpiracao)) {
    limpeza.ultima = agora;
    limpeza.proximaExpiracao = Number.POSITIVE_INFINITY;
    for (const [id, batidas] of tentativas) {
      const expira = expiracoes.get(id) ?? ((batidas.at(-1) ?? 0) + JANELA_MAXIMA);
      if (expira <= agora) {
        tentativas.delete(id);
        expiracoes.delete(id);
      } else limpeza.proximaExpiracao = Math.min(limpeza.proximaExpiracao, expira);
    }
  }
  if (!tentativas.has(chave) && tentativas.size >= MAX_CHAVES) throw new ErroNegocio("Muitas solicitações. Aguarde e tente novamente.", 429, "tentativas");
  const recentes = (tentativas.get(chave) ?? []).filter((t) => agora - t < janelaMs);
  if (recentes.length >= max) throw new ErroNegocio("Muitas tentativas. Aguarde uma hora ou fale com a barbearia.", 429, "tentativas");
  tentativas.set(chave, [...recentes, agora]);
  expiracoes.set(chave, agora + janelaMs);
  limpeza.proximaExpiracao = Math.min(limpeza.proximaExpiracao, agora + janelaMs);
}

/** Limite de acesso anterior ao JSON e ao lookup, inclusive para tokens inexistentes. */
export function limitarAcessoCheckout(req: Request) {
  const escrita = req.method === "POST";
  const ip = (req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "sem-ip").slice(0, 80);
  const origem = createHash("sha256").update(ip).digest("hex");
  limitarTentativas(`acesso:${req.method}:global`, escrita ? 600 : 6000, 60_000);
  limitarTentativas(`acesso:${req.method}:ip:${origem}`, escrita ? 60 : 600, 60_000);
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
  return (await import("@/lib/links/recuperacao")).recuperarPedidoLink(pedidoId);
}
