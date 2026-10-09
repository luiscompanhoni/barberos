/**
 * Pausa e desconto de retencao no meio de pagamento, pelo id da assinatura.
 *
 * Pagar.me (API v5, sub_): nao existe "pausar assinatura" (status so active/canceled/future).
 * - pausa: PATCH /subscriptions/{id}/billing-date { next_billing_at } empurra a proxima
 *   cobranca pelos dias da pausa. Nada e cancelado, o cartao salvo continua o mesmo
 *   (cancelar e recriar exigiria o cartao de novo: token de cartao vale uma vez so).
 * - desconto: POST /subscriptions/{id}/discounts { value, discount_type: "percentage", cycles }
 *   vale nas proximas N faturas e some sozinho.
 * Pix da Pagar.me (pixrec_) e simulado: o BarberOS gera a cobranca, entao e local
 * (proximo vencimento e valor do Pix). Celcash, Asaas e CashBarber: nao aplicam sozinhos;
 * a oferta vira "falar com o gerente".
 */
import { provedorPorId } from "./gateway";

const BASE = "https://api.pagar.me/core/v5";
export const PREFIXO_CASHBARBER = "cashbarber:";
const PREFIXO_PIX = "pixrec_";

type Fetch = typeof fetch;
let fetchImpl: Fetch = (...a) => fetch(...a);
/** So para testes. */
export function _usarFetch(f: Fetch) {
  fetchImpl = f;
}

async function pagarme(metodo: string, caminho: string, corpo: unknown) {
  const k = process.env.PAGARME_SECRET_KEY;
  if (!k) throw new Error("PAGARME_SECRET_KEY nao configurada.");
  const r = await fetchImpl(`${BASE}${caminho}`, {
    method: metodo,
    headers: { Authorization: `Basic ${Buffer.from(`${k}:`).toString("base64")}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) {
    const j = (await r.json().catch(() => ({}))) as { message?: string };
    throw new Error(`Pagar.me ${r.status}: ${j.message ?? "erro"}`);
  }
}

/** Onde a pausa/desconto e aplicada: "gateway", "local" (BarberOS gera a cobranca) ou null (nao da). */
export type Aplicacao = "gateway" | "local" | null;

export const ehCashbarber = (gatewayId: string | null) => !!gatewayId?.startsWith(PREFIXO_CASHBARBER);

export function comoAplicar(gatewayId: string | null): Aplicacao {
  if (!gatewayId || ehCashbarber(gatewayId)) return null;
  if (gatewayId.startsWith(PREFIXO_PIX)) return "local";
  const p = provedorPorId(gatewayId);
  if (p === "simulado") return "local";
  if (p === "pagarme" && gatewayId.startsWith("sub_")) return "gateway";
  return null; // celcash (celsub_), asaas
}

export const capacidades = (gatewayId: string | null) => {
  const a = comoAplicar(gatewayId);
  return { pausa: a !== null, desconto: a !== null };
};

/** Empurra a proxima cobranca da assinatura no gateway para `novaData` (AAAA-MM-DD). */
export async function adiarCobranca(gatewayId: string, novaData: string) {
  if (comoAplicar(gatewayId) !== "gateway") return;
  await pagarme("PATCH", `/subscriptions/${encodeURIComponent(gatewayId)}/billing-date`, { next_billing_at: `${novaData}T12:00:00Z` });
}

/** Desconto % nas proximas `ciclos` mensalidades no gateway. */
export async function aplicarDesconto(gatewayId: string, pct: number, ciclos: number) {
  if (comoAplicar(gatewayId) !== "gateway") return;
  await pagarme("POST", `/subscriptions/${encodeURIComponent(gatewayId)}/discounts`, { value: pct, discount_type: "percentage", cycles: ciclos });
}
