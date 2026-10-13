/**
 * Regras puras dos estornos (sem banco): quem pode, quanto pode, por onde o dinheiro volta
 * e como o financeiro desconta.
 */

export type TipoEstorno = "COMANDA" | "ANTECIPADO" | "LINK" | "MENSALIDADE";
export type StatusEstorno = "PENDENTE" | "APROVADO" | "RECUSADO" | "EXECUTADO" | "FALHOU" | "MANUAL";
/** Por onde o dinheiro volta. FORA = lancado sem integracao (maquininha manual, "ja passei"). */
export type MeioEstorno = "PAGARME" | "MAQUININHA" | "CELCASH" | "ASAAS" | "SIMULADO" | "DINHEIRO" | "FORA";
export type FormaFinanceira = "DINHEIRO" | "PIX" | "DEBITO" | "CREDITO" | "ONLINE";

/** Ainda "segura" valor do pagamento (nao da para pedir de novo por cima). */
export const STATUS_ATIVOS: StatusEstorno[] = ["PENDENTE", "APROVADO", "EXECUTADO", "MANUAL"];
/** Dinheiro ja devolvido (ou mandado devolver por fora): conta no financeiro. */
export const STATUS_EFETIVOS: StatusEstorno[] = ["EXECUTADO", "MANUAL"];

export const ROTULO_STATUS: Record<StatusEstorno, string> = {
  PENDENTE: "Aguardando o dono", APROVADO: "Executando", RECUSADO: "Recusado", EXECUTADO: "Estornado", FALHOU: "Falhou", MANUAL: "Estornar por fora",
};
export const ROTULO_TIPO: Record<TipoEstorno, string> = { COMANDA: "Comanda", ANTECIPADO: "Horário pago antes", LINK: "Link de pagamento", MENSALIDADE: "Mensalidade" };
export const ROTULO_MEIO: Record<MeioEstorno, string> = {
  PAGARME: "Pagar.me", MAQUININHA: "Maquininha (Stone)", CELCASH: "Celcash", ASAAS: "Asaas", SIMULADO: "Simulado", DINHEIRO: "Dinheiro (sangria)", FORA: "Por fora",
};

/**
 * Meio do estorno pelo id do gateway (mesmos prefixos de gatewayPorId).
 * Comanda: maquininha integrada (or_ / sim_), dinheiro ou lancado por fora.
 */
export function meioDoEstorno(p: { tipo: TipoEstorno; gatewayId: string | null; forma?: string | null }): MeioEstorno {
  const id = p.gatewayId ?? "";
  if (p.tipo === "COMANDA") {
    if (p.forma === "DINHEIRO") return "DINHEIRO";
    if (id.startsWith("sim_")) return "SIMULADO";
    if (id.startsWith("or_")) return "MAQUININHA";
    return "FORA";
  }
  if (/^cel(sub|tx|chg|cli)_/.test(id)) return "CELCASH";
  if (id.startsWith("sim")) return "SIMULADO";
  if (id.startsWith("pay_")) return "ASAAS";
  if (/^(ch|or)_/.test(id)) return "PAGARME";
  return "FORA";
}

/** Estorno parcial so onde o meio aceita (Pagar.me, maquininha via API, dinheiro, simulado). */
export function aceitaParcial(meio: MeioEstorno, tipo: TipoEstorno) {
  if (tipo === "MENSALIDADE") return false; // mensalidade: so total (a cobranca vira ESTORNADA)
  return meio === "PAGARME" || meio === "MAQUININHA" || meio === "DINHEIRO" || meio === "SIMULADO";
}

/** Forma usada no financeiro (online = horario pago antes, link e mensalidade). */
export function formaFinanceira(tipo: TipoEstorno, formaComanda?: string | null): FormaFinanceira {
  if (tipo !== "COMANDA") return "ONLINE";
  return (["DINHEIRO", "PIX", "DEBITO", "CREDITO"].includes(formaComanda ?? "") ? formaComanda : "PIX") as FormaFinanceira;
}

/**
 * Quanto ainda da para estornar: o valor menos o que ja foi pedido/estornado.
 * Na comanda o limite tambem respeita o liquido dela (o troco ja voltou para o cliente).
 */
export function limiteEstorno(p: { valorCentavos: number; jaPedido: number; liquidoComanda?: number | null }) {
  const livre = Math.max(0, p.valorCentavos - p.jaPedido);
  return p.liquidoComanda === undefined || p.liquidoComanda === null ? livre : Math.max(0, Math.min(livre, p.liquidoComanda));
}

/** Motivo para recusar o pedido (ou null se pode). */
export function erroNoPedido(p: { valorCentavos: number; limite: number; motivo: string; parcialPermitido: boolean; valorOriginal: number }) {
  if (p.motivo.trim().length < 3) return "Escreva o motivo do estorno.";
  if (!Number.isInteger(p.valorCentavos) || p.valorCentavos <= 0) return "Informe um valor maior que zero.";
  if (p.limite <= 0) return "Esse pagamento já foi estornado (ou já tem pedido de estorno).";
  if (p.valorCentavos > p.limite) return `O máximo que dá para estornar é ${reais(p.limite)}.`;
  if (!p.parcialPermitido && p.valorCentavos !== p.valorOriginal) return "Esse meio de pagamento só aceita estorno do valor total.";
  return null;
}

/** Retorno do gateway -> status final. Pendente (Pix em processamento) ja conta como executado. */
export function statusDoRetorno(r: { pendente: boolean }) {
  return { status: "EXECUTADO" as const, instrucao: r.pendente ? "Devolução em processamento no meio de pagamento (Pix)." : null };
}

/** Instrucao para o estorno feito por fora (MANUAL). */
export function instrucaoManual(meio: MeioEstorno, valorCentavos: number, detalhe?: string | null) {
  const v = reais(valorCentavos);
  switch (meio) {
    case "CELCASH": return `Estornar manualmente no painel da Celcash: ${v}${detalhe ? ` (${detalhe})` : ""}.`;
    case "ASAAS": return `Estornar manualmente no painel do Asaas: ${v}${detalhe ? ` (${detalhe})` : ""}.`;
    case "MAQUININHA": return `Estornar ${v} na própria maquininha (menu Cancelamento/Estorno)${detalhe ? `: ${detalhe}` : ""}.`;
    case "FORA": return `Pagamento lançado sem integração: estornar ${v} na maquininha ou no app do banco${detalhe ? ` (${detalhe})` : ""}.`;
    default: return `Devolver ${v} ao cliente por fora${detalhe ? ` (${detalhe})` : ""}.`;
  }
}

/** Texto do aviso no WhatsApp do dono. */
export function textoAvisoDono(p: { pedidoPor: string; descricao: string; valorCentavos: number; motivo: string; link: string }) {
  return `💸 Pedido de estorno: ${p.pedidoPor} pediu para devolver ${reais(p.valorCentavos)} (${p.descricao}).\nMotivo: ${p.motivo}\nAprove ou recuse no painel: ${p.link}`;
}

export type EstornoFinanceiro = { forma: string; valorCentavos: number; data: string };

/** Soma dos estornos por forma (o financeiro desconta isso). */
export function somarPorForma(lista: Pick<EstornoFinanceiro, "forma" | "valorCentavos">[]) {
  const t: Record<string, number> = {};
  for (const e of lista) t[e.forma] = (t[e.forma] ?? 0) + e.valorCentavos;
  return t;
}

const reais = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
