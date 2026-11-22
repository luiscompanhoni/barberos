import { AsyncLocalStorage } from "node:async_hooks";
import { ErroNegocio } from "@/lib/erros";
import { provedorPagamento, provedorPorId, type Provedor } from "./gateway";

export function cobrancasReaisBloqueadas(provedor?: Provedor | "stone") {
  return process.env.PAGAMENTOS_COBRANCAS_REAIS_BLOQUEADAS === "true"
    && (provedor ?? provedorPagamento()) !== "simulado";
}

type EtapaAdesao = "cadastro" | "primeiroCartao";
const adesaoLeonel = new AsyncLocalStorage<EtapaAdesao>();

export function naEmissaoDeAdesaoLeonel<T>(etapa: EtapaAdesao, emitir: () => Promise<T>) {
  return adesaoLeonel.run(etapa, emitir);
}

export function exigirEmissaoDeCobranca(provedor?: Provedor | "stone", requisicao?: { metodo: string; caminho: string }) {
  const fase = adesaoLeonel.getStore();
  const permitido = process.env.LEONEL_CHECKOUT_ADESAO_ATIVO === "true" && provedor === "pagarme" &&
    !!fase && (!requisicao || (requisicao.metodo === "POST" &&
      requisicao.caminho === (fase === "cadastro" ? "/customers" : "/subscriptions")));
  if (cobrancasReaisBloqueadas(provedor) && !permitido) {
    throw new ErroNegocio("A emissão de cobranças reais está temporariamente desativada. Confira pagamentos existentes com a equipe.", 503, "cobrancas_reais_bloqueadas");
  }
}

export function exigirEmissaoDeCobrancaPorId(id: string) {
  if (process.env.PAGAMENTOS_COBRANCAS_REAIS_BLOQUEADAS === "true") exigirEmissaoDeCobranca(provedorPorId(id));
}
