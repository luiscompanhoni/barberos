/**
 * Gateway de pagamento das assinaturas.
 * - "pagarme": Pagar.me (grupo Stone). Cartao tokenizado no navegador, boleto
 *   recorrente na Pagar.me e Pix gerado pelo BarberOS a cada mes.
 * - "asaas": API do Asaas (fatura hospedada com cartao, Pix e boleto).
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

export type ClienteParaGateway = { nome: string; cpf: string; telefone: string; email?: string | null; referencia: string };

export interface Gateway {
  nome: "pagarme" | "asaas" | "simulado";
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
  /** Cartao = "token": troca o cartao da assinatura (cartao recusado ou vencido). */
  atualizarCartao?(assinaturaGatewayId: string, cartaoToken: string): Promise<void>;
}

export function provedorPagamento(): "pagarme" | "asaas" | "simulado" {
  const p = process.env.PAGAMENTOS_PROVIDER;
  return p === "pagarme" || p === "asaas" ? p : "simulado";
}

export async function gateway(): Promise<Gateway> {
  switch (provedorPagamento()) {
    case "pagarme":
      return (await import("./pagarme")).pagarme;
    case "asaas":
      return (await import("./asaas")).asaas;
    default:
      return (await import("./simulado")).simulado;
  }
}
