import { somarMes } from "./regras";

export const formasPagamentoRegistrado = ["PIX", "CARTAO", "BOLETO"] as const;

export function vencimentoDoRegistro(pagoEm: string, proximoVencimento?: string) {
  return proximoVencimento ?? somarMes(pagoEm);
}

export function fimDoCicloManual(a: {
  gatewayId: string | null;
  ultimoPagamentoManualEm: Date | null;
  proximoVencimento: Date | null;
}) {
  return a.ultimoPagamentoManualEm && !a.gatewayId ? a.proximoVencimento?.toISOString().slice(0, 10) ?? "" : null;
}
