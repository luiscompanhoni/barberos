import { ErroNegocio } from "@/lib/erros";
import { provedorPagamento, provedorPorId, type Provedor } from "./gateway";

export function cobrancasReaisBloqueadas(provedor?: Provedor | "stone") {
  return process.env.PAGAMENTOS_COBRANCAS_REAIS_BLOQUEADAS === "true"
    && (provedor ?? provedorPagamento()) !== "simulado";
}

export function exigirEmissaoDeCobranca(provedor?: Provedor | "stone") {
  if (cobrancasReaisBloqueadas(provedor)) {
    throw new ErroNegocio("A emissão de cobranças reais está temporariamente desativada. Confira pagamentos existentes com a equipe.", 503, "cobrancas_reais_bloqueadas");
  }
}

export function exigirEmissaoDeCobrancaPorId(id: string) {
  if (process.env.PAGAMENTOS_COBRANCAS_REAIS_BLOQUEADAS === "true") exigirEmissaoDeCobranca(provedorPorId(id));
}
