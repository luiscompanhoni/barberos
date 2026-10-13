/**
 * Integracao com a Celcash / cel_payments (antiga Galax Pay, grupo Celcoin).
 * Docs: https://docs-celpayments.celcoin.com.br
 * - A assinatura mensal e da propria Celcash: ela gera o Pix (ou boleto) de cada mes sozinha.
 * - Cartao: o cliente cadastra o cartao no link da Celcash (paymentLink); o BarberOS nunca ve o cartao.
 * - Os IDs ganham prefixo (celsub_/celtx_/celcli_) para nao confundir com outros gateways.
 */
import type { FormaPagamento } from "@prisma/client";
import type { CobrancaAvulsa, CobrancaGateway, Gateway } from "./gateway";

const ESCOPOS = "customers.read customers.write subscriptions.read subscriptions.write charges.read charges.write transactions.read transactions.write";
export const PREFIXO = { assinatura: "celsub_", transacao: "celtx_", cliente: "celcli_", avulsa: "celchg_" } as const;
const semPrefixo = (id: string, p: string) => (id.startsWith(p) ? id.slice(p.length) : id);

function config() {
  const id = process.env.CELCASH_GALAX_ID;
  const hash = process.env.CELCASH_GALAX_HASH;
  if (!id || !hash) throw new Error("CELCASH_GALAX_ID e CELCASH_GALAX_HASH não configurados.");
  const base = process.env.CELCASH_AMBIENTE === "producao" ? "https://api-celcash.celcoin.com.br/v2" : "https://api.sandbox.cel.cash/v2";
  return { base, basic: Buffer.from(`${id}:${hash}`).toString("base64") };
}

// O token vale 600s: guarda e renova um pouco antes.
let tokenCache: { valor: string; ate: number; base: string } | null = null;
async function token() {
  const { base, basic } = config();
  if (tokenCache && tokenCache.base === base && tokenCache.ate > Date.now()) return tokenCache.valor;
  const r = await fetch(`${base}/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "authorization_code", scope: ESCOPOS }),
    signal: AbortSignal.timeout(20_000),
  });
  const j = (await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: { message?: string } };
  if (!r.ok || !j.access_token) throw new Error(`Celcash (token): ${j.error?.message ?? `HTTP ${r.status}`}`);
  tokenCache = { valor: j.access_token, ate: Date.now() + Math.max(60, (j.expires_in ?? 600) - 60) * 1000, base };
  return j.access_token;
}

async function chamar<T>(metodo: string, caminho: string, corpo?: unknown): Promise<T> {
  const { base } = config();
  const r = await fetch(`${base}${caminho}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
    signal: AbortSignal.timeout(20_000),
  });
  const j = (await r.json().catch(() => ({}))) as T & { error?: { message?: string; details?: unknown } };
  if (!r.ok || (j as { type?: boolean }).type === false) {
    const det = j.error?.details ? ` ${JSON.stringify(j.error.details).slice(0, 300)}` : "";
    throw new Error(`Celcash: ${j.error?.message ?? `HTTP ${r.status}`}${det}`);
  }
  return j;
}

type Transacao = {
  galaxPayId: number;
  subscriptionGalaxPayId?: number | null;
  value: number;
  payday: string;
  paydayDate?: string | null;
  status: string;
  Pix?: { qrCode?: string | null; image?: string | null; page?: string | null } | null;
  Boleto?: { pdf?: string | null; bankLine?: string | null } | null;
};
type Assinatura = { galaxPayId: number; paymentLink?: string | null; mainPaymentMethodId: string; Transactions?: Transacao[] };
type Avulsa = { galaxPayId: number; paymentLink?: string | null; mainPaymentMethodId: string; Transactions?: Transacao[] };

const METODO: Record<FormaPagamento, string> = { PIX: "pix", CARTAO: "creditcard", BOLETO: "boleto" };
const FORMA: Record<string, FormaPagamento> = { pix: "PIX", creditcard: "CARTAO", boleto: "BOLETO" };

const PAGOS = ["captured", "payedBoleto", "payedPix", "payExternal", "free", "lessValueBoleto", "moreValueBoleto", "paidDuplicityBoleto"];
const ABERTOS = ["notSend", "authorized", "pendingBoleto", "pendingPix"];

/** Status da Celcash -> status interno. Em aberto depois do vencimento conta como atrasada. */
export function traduzirStatus(status: string, vencimento: string, hoje: string): CobrancaGateway["status"] {
  if (PAGOS.includes(status)) return "PAGA";
  if (status === "reversed" || status === "chargeback") return "ESTORNADA";
  if (status === "cancel" || status === "cancelByContract") return "CANCELADA";
  if (status === "denied" || status === "notCompensated" || status === "unavailablePix") return "ATRASADA";
  if (ABERTOS.includes(status)) return vencimento < hoje ? "ATRASADA" : "PENDENTE";
  return "PENDENTE";
}

const hojeSp = () => new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);

export function converter(t: Transacao, a: Pick<Assinatura, "paymentLink" | "mainPaymentMethodId"> | null): CobrancaGateway {
  const forma = a ? FORMA[a.mainPaymentMethodId] ?? null : t.Pix?.qrCode ? "PIX" : null;
  const status = traduzirStatus(t.status, t.payday, hojeSp());
  return {
    id: `${PREFIXO.transacao}${t.galaxPayId}`,
    assinaturaGatewayId: t.subscriptionGalaxPayId ? `${PREFIXO.assinatura}${t.subscriptionGalaxPayId}` : null,
    valorCentavos: t.value,
    vencimento: t.payday,
    status,
    pagaEm: status === "PAGA" ? (t.paydayDate ?? t.payday) : null,
    // Cartao: link da assinatura para cadastrar/trocar o cartao. Pix/boleto: a pagina da cobranca.
    link: forma === "CARTAO" ? (a?.paymentLink ?? null) : (t.Pix?.page ?? t.Boleto?.pdf ?? a?.paymentLink ?? null),
    forma,
    pixCopiaECola: forma === "PIX" ? (t.Pix?.qrCode ?? null) : null,
    pixQrUrl: forma === "PIX" ? (t.Pix?.image ?? null) : null,
    boletoUrl: forma === "BOLETO" ? (t.Boleto?.pdf ?? null) : null,
    boletoLinha: forma === "BOLETO" ? (t.Boleto?.bankLine ?? null) : null,
  };
}

/** Cobranca avulsa -> formato interno (status pela transacao unica dela). */
export function converterAvulsa(c: Avulsa): CobrancaAvulsa {
  const t = c.Transactions?.[0];
  const base = t ? converter(t, { mainPaymentMethodId: c.mainPaymentMethodId, paymentLink: c.paymentLink }) : null;
  return {
    id: `${PREFIXO.avulsa}${c.galaxPayId}`,
    // Avulsa nao "atrasa": em aberto continua pendente ate pagar ou cancelar.
    status: !base ? "PENDENTE" : base.status === "ATRASADA" && t && ABERTOS.includes(t.status) ? "PENDENTE" : base.status,
    pagaEm: base?.pagaEm ?? null,
    link: base?.link ?? c.paymentLink ?? null,
    pixCopiaECola: base?.pixCopiaECola ?? null,
    pixQrUrl: base?.pixQrUrl ?? null,
  };
}

async function assinaturaPorId(galaxPayId: string) {
  const r = await chamar<{ Subscriptions: Assinatura[] }>("GET", `/subscriptions?galaxPayIds=${encodeURIComponent(galaxPayId)}&startAt=0&limit=1`);
  const a = r.Subscriptions?.[0];
  if (!a) throw new Error(`Celcash: assinatura ${galaxPayId} não encontrada.`);
  return a;
}

export const celcash: Gateway = {
  nome: "celcash",
  cartao: "hospedado",
  pix: "nativo",
  exigeEmail: true,

  async criarCliente(c) {
    const corpo = {
      myId: c.referencia, name: c.nome, document: c.cpf, emails: c.email ? [c.email] : [],
      phones: [Number(c.telefone.replace(/^55/, ""))],
    };
    try {
      const r = await chamar<{ Customer: { galaxPayId: number } }>("POST", "/customers", corpo);
      return `${PREFIXO.cliente}${r.Customer.galaxPayId}`;
    } catch (e) {
      // Ja cadastrado (mesmo myId ou CPF): reaproveita.
      const r = await chamar<{ Customers: { galaxPayId: number }[] }>("GET", `/customers?myIds=${encodeURIComponent(c.referencia)}&startAt=0&limit=1`).catch(() => null);
      const porCpf = r?.Customers?.[0] ?? (await chamar<{ Customers: { galaxPayId: number }[] }>("GET", `/customers?documents=${c.cpf}&startAt=0&limit=1`).catch(() => null))?.Customers?.[0];
      if (porCpf) return `${PREFIXO.cliente}${porCpf.galaxPayId}`;
      throw e;
    }
  },

  async criarAssinatura(a) {
    if (a.forma === "BOLETO") throw new Error("Celcash: boleto exige endereço do cliente; use Pix ou cartão.");
    const r = await chamar<{ Subscription: Assinatura }>("POST", "/subscriptions", {
      myId: a.referencia,
      value: a.valorCentavos,
      quantity: 0, // indeterminada: cobra todo mes ate cancelar
      periodicity: "monthly",
      firstPayDayDate: a.primeiroVencimento,
      mainPaymentMethodId: METODO[a.forma],
      additionalInfo: a.descricao.slice(0, 500),
      Customer: { galaxPayId: Number(semPrefixo(a.clienteGatewayId, PREFIXO.cliente)) },
      ...(a.forma === "CARTAO" ? { PaymentMethodCreditCard: {} } : { PaymentMethodPix: { instructions: a.descricao.slice(0, 255) } }),
    });
    return `${PREFIXO.assinatura}${r.Subscription.galaxPayId}`;
  },

  async cobrancasDaAssinatura(id) {
    const a = await assinaturaPorId(semPrefixo(id, PREFIXO.assinatura));
    return (a.Transactions ?? []).map((t) => converter({ ...t, subscriptionGalaxPayId: t.subscriptionGalaxPayId ?? a.galaxPayId }, a));
  },

  async buscarCobranca(id) {
    const r = await chamar<{ Transactions: Transacao[] }>("GET", `/transactions?galaxPayIds=${encodeURIComponent(semPrefixo(id, PREFIXO.transacao))}&startAt=0&limit=1`);
    const t = r.Transactions?.[0];
    if (!t) throw new Error(`Celcash: transação ${id} não encontrada.`);
    const a = t.subscriptionGalaxPayId ? await assinaturaPorId(String(t.subscriptionGalaxPayId)).catch(() => null) : null;
    return converter(t, a);
  },

  async cancelarAssinatura(id) {
    await chamar("DELETE", `/subscriptions/${encodeURIComponent(semPrefixo(id, PREFIXO.assinatura))}/galaxPayId`);
  },
};

// Cobranca avulsa: pagamento antecipado de um horario.
celcash.criarCobrancaAvulsa = async (c) => {
  if (c.forma === "BOLETO") throw new Error("Celcash: boleto exige endereço do cliente; use Pix ou cartão.");
  const r = await chamar<{ Charge: Avulsa }>("POST", "/charges", {
    myId: c.referencia,
    value: c.valorCentavos,
    payday: c.vencimento,
    mainPaymentMethodId: METODO[c.forma],
    additionalInfo: c.descricao.slice(0, 500),
    Customer: { galaxPayId: Number(semPrefixo(c.clienteGatewayId, PREFIXO.cliente)) },
    ...(c.forma === "CARTAO" ? { PaymentMethodCreditCard: {} } : { PaymentMethodPix: { instructions: c.descricao.slice(0, 255) } }),
  });
  return converterAvulsa(r.Charge);
};

celcash.buscarCobrancaAvulsa = async (id) => {
  const r = await chamar<{ Charges: Avulsa[] }>("GET", `/charges?galaxPayIds=${encodeURIComponent(semPrefixo(id, PREFIXO.avulsa))}&startAt=0&limit=1`);
  const c = r.Charges?.[0];
  if (!c) throw new Error(`Celcash: cobrança ${id} não encontrada.`);
  return converterAvulsa(c);
};

celcash.cancelarCobrancaAvulsa = async (id) => {
  await chamar("DELETE", `/charges/${encodeURIComponent(semPrefixo(id, PREFIXO.avulsa))}/galaxPayId`);
};
