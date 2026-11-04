import type { CobrancaAvulsa } from "@/lib/pagamentos/gateway";

export function valorDoLinkConfere(c: CobrancaAvulsa, valor: number) {
  return Number.isSafeInteger(valor) && valor > 0 && c.moeda === "BRL" && Number.isSafeInteger(c.valorCentavos) && c.valorCentavos === valor;
}
export function liquidacaoDoLinkConfere(c: CobrancaAvulsa, valor: number) {
  return valorDoLinkConfere(c, valor) && Number.isSafeInteger(c.liquidadoCentavos) && c.liquidadoCentavos === valor;
}
export function encerramentoDoLinkConfere(c: CobrancaAvulsa, valor: number) {
  return valorDoLinkConfere(c, valor) && c.liquidadoCentavos === 0;
}
export const chaveEmConferencia = (chave: string | null, id: string) => chave?.startsWith("conferir:") ? chave : `conferir:${chave || id}`;
