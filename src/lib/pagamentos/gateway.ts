/**
 * Gateway de pagamento das assinaturas.
 * - "pagarme": Pagar.me (grupo Stone). Cartao tokenizado no navegador, boleto
 *   recorrente na Pagar.me e Pix gerado pelo BarberOS a cada mes.
 * - "asaas": API do Asaas (fatura hospedada com cartao, Pix e boleto).
 * - "celcash": Celcash/cel_payments (assinatura com Pix mensal da propria Celcash; cartao no link dela).
 * - "simulado": nada sai do servidor; a cobranca e paga numa tela de teste
 *   (/c/pagamento-simulado/...) que dispara o mesmo processamento do webhook.
 */
import type { FormaPagamento } from "@prisma/client";

export type CobrancaGateway = {
  id: string;
  assinaturaGatewayId: string | null;
  valorCentavos: number;
  vencimento: string; // AAAA-MM-DD
  status: "PENDENTE" | "PAGA" | "ATRASADA" | "CANCELADA" | "ESTORNADA";
  pagaEm: string | null;
  /** Link externo de pagamento (fatura hospedada). null = usar a pagina do BarberOS. */
  link: string | null;
  forma?: FormaPagamento | null;
  pixCopiaECola?: string | null;
  pixQrUrl?: string | null;
  expiraEm?: string | null;
  boletoUrl?: string | null;
  boletoLinha?: string | null;
};

/** Cobranca avulsa (horario pago antes ou link de pagamento). */
export type CobrancaAvulsa = {
  id: string;
  /** Cartao recusado vem como ATRASADA, com o motivo em `erro`. */
  status: CobrancaGateway["status"];
  pagaEm: string | null;
  link: string | null;
  forma?: FormaPagamento | null;
  pixCopiaECola?: string | null;
  pixQrUrl?: string | null;
  /** Validade do Pix (ISO). */
  expiraEm?: string | null;
  /** Motivo da recusa do cartao (texto para o cliente). */
  erro?: string | null;
};

export type ClienteParaGateway = { nome: string; cpf: string; telefone: string; email?: string | null; referencia: string };

export interface Gateway {
  nome: "pagarme" | "asaas" | "celcash" | "simulado";
  /**
   * "hospedado": o gateway tem pagina propria para o cartao (Asaas, simulado).
   * "token": o cartao e digitado na pagina do BarberOS e vira token no navegador (Pagar.me).
   */
  cartao: "hospedado" | "token";
  /** "nativo": a assinatura do gateway cobra Pix sozinha. "avulso": o BarberOS gera um Pix por mes. */
  pix: "nativo" | "avulso";
  /** Exige e-mail do cliente (Pagar.me exige para Pix). */
  exigeEmail: boolean;

  criarCliente(c: ClienteParaGateway): Promise<string>;
  criarAssinatura(a: {
    clienteGatewayId: string;
    valorCentavos: number;
    forma: FormaPagamento;
    primeiroVencimento: string;
    descricao: string;
    referencia: string;
    /** So com cartao = "token". */
    cartaoToken?: string;
  }): Promise<string>;
  cobrancasDaAssinatura(assinaturaGatewayId: string): Promise<CobrancaGateway[]>;
  buscarCobranca(cobrancaGatewayId: string): Promise<CobrancaGateway>;
  cancelarAssinatura(assinaturaGatewayId: string): Promise<void>;

  /** Pix = "avulso": gera a cobranca Pix de um mes. */
  criarCobrancaPix?(c: {
    clienteGatewayId: string;
    valorCentavos: number;
    vencimento: string;
    descricao: string;
    referencia: string;
    validadeHoras: number;
  }): Promise<CobrancaGateway>;
  /**
   * Cobranca avulsa (horario pago antes, link de pagamento). So nos gateways que suportam.
   * Cartao = "token": o cartao e cobrado na hora com `cartaoToken` (sem link hospedado).
   */
  criarCobrancaAvulsa?(c: {
    clienteGatewayId: string;
    valorCentavos: number;
    forma: FormaPagamento;
    vencimento: string;
    descricao: string;
    referencia: string;
    cartaoToken?: string;
    /** So cartao (1 = a vista). */
    parcelas?: number;
    /** So Pix: validade em segundos (padrao 1 dia). */
    pixValidadeSeg?: number;
  }): Promise<CobrancaAvulsa>;
  buscarCobrancaAvulsa?(id: string): Promise<CobrancaAvulsa>;
  cancelarCobrancaAvulsa?(id: string): Promise<void>;
  /** Cancela uma cobranca de mensalidade em aberto (ex.: Pix do 1o mes ao trocar para cartao). */
  cancelarCobranca?(cobrancaGatewayId: string): Promise<void>;
  /** Cartao = "token": troca o cartao da assinatura (cartao recusado ou vencido). */
  atualizarCartao?(assinaturaGatewayId: string, cartaoToken: string): Promise<void>;
}

export type Provedor = Gateway["nome"];

/** Provedor do env: decide so o que e NOVO (registros antigos seguem o prefixo do id). */
export function provedorPagamento(): Provedor {
  const p = process.env.PAGAMENTOS_PROVIDER;
  return p === "pagarme" || p === "asaas" || p === "celcash" ? p : "simulado";
}

/**
 * Gateway dono de um id ja salvo, pelo prefixo. Celcash: celsub_/celtx_/celchg_/celcli_.
 * Pagar.me: sub_/ch_/or_/cus_/in_/pixrec_. Simulado: sim*. Asaas: pay_ (sub_/cus_ do
 * Asaas so quando ele e o provedor atual). Desconhecido: o provedor do env.
 */
export function provedorPorId(id: string, atual: Provedor = provedorPagamento()): Provedor {
  if (/^cel(sub|tx|chg|cli)_/.test(id)) return "celcash";
  if (id.startsWith("sim")) return "simulado";
  if (id.startsWith("pay_")) return "asaas";
  if (/^(sub|cus)_/.test(id) && atual === "asaas") return "asaas";
  if (/^(sub|ch|or|cus|in|card|pixrec)_/.test(id)) return "pagarme";
  return atual;
}

/** Gateway para agir sobre um registro existente (sincronizar, cancelar, webhook). */
export async function gatewayPorId(id: string): Promise<Gateway> {
  return carregar(provedorPorId(id));
}

export async function gateway(): Promise<Gateway> {
  return carregar(provedorPagamento());
}

async function carregar(p: Provedor): Promise<Gateway> {
  switch (p) {
    case "pagarme":
      return (await import("./pagarme")).pagarme;
    case "asaas":
      return (await import("./asaas")).asaas;
    case "celcash":
      return (await import("./celcash")).celcash;
    default:
      return (await import("./simulado")).simulado;
  }
}
