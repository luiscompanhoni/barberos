/**
 * Integracao com a Pagar.me (API v5, grupo Stone) - https://docs.pagar.me
 *
 * - Cartao: o cliente digita na pagina do BarberOS, mas o numero vai direto do
 *   navegador para a Pagar.me (POST /tokens com a chave publica). O servidor so
 *   recebe o token. A Pagar.me cobra todo mes sozinha (assinatura "avulsa").
 * - Boleto: assinatura na Pagar.me; o boleto de cada mes vem nas cobrancas.
 * - Pix: assinatura da Pagar.me nao aceita Pix, entao o BarberOS cria um pedido
 *   Pix por mes (ver lib/assinaturas/rotina.ts). A "assinatura" no gateway e so
 *   um marcador local: "pixrec_<id da assinatura>".
 */
import type { FormaPagamento } from "@prisma/client";
import type { CobrancaGateway, Gateway } from "./gateway";

const BASE = "https://api.pagar.me/core/v5";
export const PREFIXO_PIX = "pixrec_";

function chave() {
  const k = process.env.PAGARME_SECRET_KEY;
  if (!k) throw new Error("PAGARME_SECRET_KEY nao configurada.");
  return k;
}

type Fetch = typeof fetch;
let fetchImpl: Fetch = (...a) => fetch(...a);
/** So para testes. */
export function _usarFetch(f: Fetch) {
  fetchImpl = f;
}

async function chamar<T>(metodo: string, caminho: string, corpo?: unknown): Promise<T> {
  const r = await fetchImpl(`${BASE}${caminho}`, {
    method: metodo,
    headers: {
      Authorization: `Basic ${Buffer.from(`${chave()}:`).toString("base64")}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const json = (await r.json().catch(() => ({}))) as T & { message?: string; errors?: Record<string, string[]> };
  if (!r.ok) {
    const detalhes = json.errors ? Object.values(json.errors).flat().join("; ") : "";
    throw new Error(`Pagar.me ${r.status}: ${json.message ?? "erro"}${detalhes ? ` (${detalhes})` : ""}`);
  }
  return json;
}

// ---------------------------------------------------------------- conversoes

type TransacaoPagarme = {
  url?: string | null;
  pdf?: string | null;
  line?: string | null;
  qr_code?: string | null;
  qr_code_url?: string | null;
  expires_at?: string | null;
};
export type CobrancaPagarme = {
  id: string;
  amount: number;
  status: string;
  payment_method?: string;
  due_at?: string | null;
  paid_at?: string | null;
  created_at?: string;
  invoice?: { id?: string; subscription_id?: string; subscriptionId?: string; subscription?: { id?: string } } | null;
  metadata?: Record<string, string> | null;
  last_transaction?: TransacaoPagarme | null;
};

/** Status da cobranca na Pagar.me -> status interno. */
export function traduzirStatus(status: string): CobrancaGateway["status"] {
  switch (status) {
    case "paid":
    case "overpaid":
      return "PAGA";
    case "failed":
    case "payment_failed":
      return "ATRASADA";
    case "canceled":
    case "partial_canceled":
      return "CANCELADA";
    case "refunded":
    case "pending_refund":
    case "chargedback":
      return "ESTORNADA";
    default: // pending, processing, underpaid
      return "PENDENTE";
  }
}

const FORMA: Record<string, FormaPagamento> = { credit_card: "CARTAO", boleto: "BOLETO", pix: "PIX" };

export function converterCobranca(c: CobrancaPagarme, assinaturaGatewayId?: string | null): CobrancaGateway {
  const t = c.last_transaction ?? {};
  const sub = c.invoice?.subscription_id ?? c.invoice?.subscriptionId ?? c.invoice?.subscription?.id ?? c.metadata?.assinatura_gateway_id ?? null;
  return {
    id: c.id,
    assinaturaGatewayId: assinaturaGatewayId ?? sub,
    valorCentavos: c.amount,
    vencimento: (c.due_at ?? c.metadata?.vencimento ?? c.created_at ?? new Date().toISOString()).slice(0, 10),
    status: traduzirStatus(c.status),
    pagaEm: c.paid_at ?? null,
    link: null, // a pagina de pagamento e a do BarberOS (/c/pagar/...)
    forma: c.payment_method ? (FORMA[c.payment_method] ?? null) : null,
    pixCopiaECola: t.qr_code ?? null,
    pixQrUrl: t.qr_code_url ?? null,
    expiraEm: t.expires_at ?? null,
    boletoUrl: t.pdf ?? t.url ?? null,
    boletoLinha: t.line ?? null,
  };
}

/** "5511999998888" -> telefone no formato da Pagar.me */
export function telefonePagarme(tel: string) {
  const d = tel.replace(/\D/g, "").replace(/^55/, "");
  return { country_code: "55", area_code: d.slice(0, 2), number: d.slice(2) };
}

/** Nome na fatura do cartao: ate 13 caracteres, sem acento nem simbolo. */
export function descritorFatura(nome: string) {
  return nome.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9 ]/g, "").trim().slice(0, 13) || "BARBEARIA";
}

// ---------------------------------------------------------------- gateway

export const pagarme: Gateway = {
  nome: "pagarme",
  cartao: "token",
  pix: "avulso",
  exigeEmail: true,

  async criarCliente(c) {
    const r = await chamar<{ id: string }>("POST", "/customers", {
      name: c.nome,
      email: c.email,
      document: c.cpf,
      document_type: "CPF",
      type: "individual",
      code: c.referencia,
      phones: { mobile_phone: telefonePagarme(c.telefone) },
    });
    return r.id;
  },

  async criarAssinatura(a) {
    if (a.forma === "PIX") return `${PREFIXO_PIX}${a.referencia}`; // Pix mensal e gerado pelo BarberOS
    if (a.forma === "CARTAO" && !a.cartaoToken) throw new Error("Cartão não informado.");
    const r = await chamar<{ id: string }>("POST", "/subscriptions", {
      customer_id: a.clienteGatewayId,
      payment_method: a.forma === "CARTAO" ? "credit_card" : "boleto",
      ...(a.forma === "CARTAO" ? { card_token: a.cartaoToken } : { boleto_due_days: 3 }),
      interval: "month",
      interval_count: 1,
      billing_type: "prepaid",
      installments: 1,
      currency: "BRL",
      statement_descriptor: descritorFatura(process.env.NOME_FATURA ?? a.descricao),
      items: [{ description: a.descricao.slice(0, 256), quantity: 1, pricing_scheme: { scheme_type: "unit", price: a.valorCentavos } }],
      metadata: { assinatura_id: a.referencia },
    });
    return r.id;
  },

  async cobrancasDaAssinatura(id) {
    if (id.startsWith(PREFIXO_PIX)) return []; // cobrancas Pix ja estao no banco do BarberOS
    const r = await chamar<{ data: { id: string; charge?: { id: string } | null }[] }>(
      "GET", `/invoices?subscription_id=${encodeURIComponent(id)}&size=24`,
    );
    const out: CobrancaGateway[] = [];
    for (const inv of r.data) {
      if (!inv.charge?.id) continue;
      const c = await chamar<CobrancaPagarme>("GET", `/charges/${encodeURIComponent(inv.charge.id)}`);
      out.push(converterCobranca(c, id));
    }
    return out;
  },

  async buscarCobranca(id) {
    const c = await chamar<CobrancaPagarme>("GET", `/charges/${encodeURIComponent(id)}`);
    let sub = converterCobranca(c).assinaturaGatewayId;
    // A cobranca pode trazer so o id da fatura: a assinatura esta na fatura.
    if (!sub && c.invoice?.id) {
      const inv = await chamar<{ subscription_id?: string; subscription?: { id?: string } }>("GET", `/invoices/${encodeURIComponent(c.invoice.id)}`);
      sub = inv.subscription_id ?? inv.subscription?.id ?? null;
    }
    return converterCobranca(c, sub);
  },

  async cancelarAssinatura(id) {
    if (id.startsWith(PREFIXO_PIX)) return;
    await chamar("DELETE", `/subscriptions/${encodeURIComponent(id)}`);
  },

  async criarCobrancaPix(p) {
    const r = await chamar<{ id: string; charges?: CobrancaPagarme[] }>("POST", "/orders", {
      code: `${p.referencia}-${p.vencimento}`.slice(0, 52),
      customer_id: p.clienteGatewayId,
      items: [{ code: "mensalidade", description: p.descricao.slice(0, 256), quantity: 1, amount: p.valorCentavos }],
      payments: [{ payment_method: "pix", pix: { expires_in: p.validadeHoras * 3600 } }],
      metadata: { assinatura_gateway_id: p.referencia, vencimento: p.vencimento },
    });
    const c = r.charges?.[0];
    if (!c) throw new Error("Pagar.me não devolveu a cobrança Pix.");
    return { ...converterCobranca(c, p.referencia), vencimento: p.vencimento, forma: "PIX" };
  },

  async atualizarCartao(id, token) {
    await chamar("PATCH", `/subscriptions/${encodeURIComponent(id)}/card`, { card_token: token });
  },
};

// ---------------------------------------------------------------- Stone Connect 2.0 (maquininha)
// Doc: https://connect-stone.stone.com.br - o pedido criado aqui aparece na maquininha
// (S920/Q92) cujo numero de serie foi informado; pago no POS, a Pagar.me manda webhook.

export type PedidoPOS = {
  id: string;
  code?: string;
  status: string; // pending | paid | canceled | failed
  charges?: { id: string; code?: string; status: string; payment_method?: string; metadata?: Record<string, string> | null }[];
};

export type TipoPOS = "credit" | "debit" | "pix";

/** Cria o pedido "direto" (ja com a forma escolhida) na maquininha. */
export async function criarPedidoMaquininha(p: {
  referencia: string;
  valorCentavos: number;
  descricao: string;
  tipo: TipoPOS;
  serial: string;
  cliente: { nome: string; email: string };
  metadata?: Record<string, string>;
}) {
  return chamar<PedidoPOS>("POST", "/orders", {
    code: p.referencia.slice(0, 52),
    customer: { name: p.cliente.nome.slice(0, 64), email: p.cliente.email },
    items: [{ code: "comanda", amount: p.valorCentavos, description: p.descricao.slice(0, 256), quantity: 1 }],
    closed: false,
    poi_payment_settings: {
      visible: true,
      print_order_receipt: false,
      devices_serial_number: [p.serial],
      display_name: p.descricao.slice(0, 30),
      payment_setup: { type: p.tipo, ...(p.tipo === "credit" ? { installments: 1, installment_type: "merchant" } : {}) },
    },
    metadata: p.metadata ?? {},
  });
}

export async function buscarPedido(id: string) {
  return chamar<PedidoPOS>("GET", `/orders/${encodeURIComponent(id)}`);
}

/** Tira o pedido da fila da maquininha (limite de 30 abertos). Pago -> "paid"; desistiu -> "canceled". */
export async function fecharPedido(id: string, status: "paid" | "canceled" | "failed") {
  await chamar("PATCH", `/orders/${encodeURIComponent(id)}/closed`, { status });
}
