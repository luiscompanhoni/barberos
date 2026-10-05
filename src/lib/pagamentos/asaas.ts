/**
 * Integracao com o Asaas (https://docs.asaas.com). Cartao, Pix e boleto sao
 * pagos na fatura do proprio Asaas (invoiceUrl): o BarberOS nunca ve dados de cartao.
 */
import type { FormaPagamento } from "@prisma/client";
import type { CobrancaGateway, Gateway } from "./gateway";

function config() {
  const chave = process.env.ASAAS_API_KEY;
  if (!chave) throw new Error("ASAAS_API_KEY nao configurada.");
  const base = process.env.ASAAS_AMBIENTE === "producao" ? "https://api.asaas.com/v3" : "https://api-sandbox.asaas.com/v3";
  return { chave, base };
}

async function chamar<T>(metodo: string, caminho: string, corpo?: unknown): Promise<T> {
  const { chave, base } = config();
  const r = await fetch(`${base}${caminho}`, {
    method: metodo,
    headers: { access_token: chave, "Content-Type": "application/json", "User-Agent": "BarberOS" },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const json = (await r.json().catch(() => ({}))) as T & { errors?: { description?: string }[] };
  if (!r.ok) {
    const msg = json.errors?.map((e) => e.description).join("; ") || `HTTP ${r.status}`;
    throw new Error(`Asaas: ${msg}`);
  }
  return json;
}

const FORMA: Record<FormaPagamento, string> = { CARTAO: "CREDIT_CARD", PIX: "PIX", BOLETO: "BOLETO" };

type PagamentoAsaas = {
  id: string;
  subscription?: string | null;
  value: number;
  dueDate: string;
  status: string;
  invoiceUrl?: string | null;
  paymentDate?: string | null;
  clientPaymentDate?: string | null;
  confirmedDate?: string | null;
  deleted?: boolean;
};

/** Status do Asaas -> status interno. */
export function traduzirStatus(p: Pick<PagamentoAsaas, "status" | "deleted">): CobrancaGateway["status"] {
  if (p.deleted) return "CANCELADA";
  switch (p.status) {
    case "RECEIVED":
    case "CONFIRMED":
    case "RECEIVED_IN_CASH":
      return "PAGA";
    case "OVERDUE":
      return "ATRASADA";
    case "REFUNDED":
    case "REFUND_REQUESTED":
    case "REFUND_IN_PROGRESS":
    case "CHARGEBACK_REQUESTED":
    case "CHARGEBACK_DISPUTE":
    case "AWAITING_CHARGEBACK_REVERSAL":
      return "ESTORNADA";
    default:
      return "PENDENTE";
  }
}

function converter(p: PagamentoAsaas): CobrancaGateway {
  return {
    id: p.id,
    assinaturaGatewayId: p.subscription ?? null,
    valorCentavos: Math.round(p.value * 100),
    vencimento: p.dueDate,
    status: traduzirStatus(p),
    pagaEm: p.confirmedDate ?? p.paymentDate ?? p.clientPaymentDate ?? null,
    link: p.invoiceUrl ?? null,
  };
}

export const asaas: Gateway = {
  nome: "asaas",
  cartao: "hospedado",
  pix: "nativo",
  exigeEmail: false,

  async criarCliente(c) {
    const r = await chamar<{ id: string }>("POST", "/customers", {
      name: c.nome,
      cpfCnpj: c.cpf,
      mobilePhone: c.telefone.replace(/^55/, ""),
      email: c.email ?? undefined,
      externalReference: c.referencia,
      notificationDisabled: true, // os avisos saem pelo WhatsApp da barbearia
    });
    return r.id;
  },

  async criarAssinatura(a) {
    const r = await chamar<{ id: string }>("POST", "/subscriptions", {
      customer: a.clienteGatewayId,
      billingType: FORMA[a.forma],
      value: a.valorCentavos / 100,
      nextDueDate: a.primeiroVencimento,
      cycle: "MONTHLY",
      description: a.descricao.slice(0, 500),
      externalReference: a.referencia,
    });
    return r.id;
  },

  async cobrancasDaAssinatura(id) {
    const r = await chamar<{ data: PagamentoAsaas[] }>("GET", `/subscriptions/${encodeURIComponent(id)}/payments`);
    return r.data.map(converter);
  },

  async buscarCobranca(id) {
    return converter(await chamar<PagamentoAsaas>("GET", `/payments/${encodeURIComponent(id)}`));
  },

  async cancelarAssinatura(id) {
    await chamar("DELETE", `/subscriptions/${encodeURIComponent(id)}`);
  },
};
