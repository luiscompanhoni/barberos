/**
 * Regras puras do checkout do BarberOS (sem banco): estado mostrado na tela, validade do Pix,
 * parcelas e situacao dos links de pagamento. Usado no servidor e no navegador.
 */

/** Como o cartao e pago no checkout. */
export type ModoCartao =
  /** Pagar.me: digitado aqui, tokenizado no navegador com a chave publica. */
  | "token"
  /** Gateway simulado (so fora de producao): cartao de teste, nada e cobrado. */
  | "teste"
  /** Celcash/Asaas: o cartao e pago na pagina do gateway (link). */
  | "hospedado"
  /** Pagar.me sem chave publica configurada. */
  | "indisponivel";

export type StatusCheckout = "PENDENTE" | "PAGO" | "CANCELADO" | "EXPIRADO";

/** O que a tela do checkout precisa saber (devolvido pelas APIs de pagamento). */
export type EstadoCheckout = {
  status: StatusCheckout;
  forma: "PIX" | "CARTAO" | null;
  pix: { copiaECola: string; qrUrl: string | null; expiraEm: string | null } | null;
  /** Pagina externa (cartao hospedado) ou de teste (simulado). */
  link: string | null;
  /** Cartao em analise (ainda nao aprovado nem recusado). */
  processando?: boolean;
  mensagem?: string | null;
};

export const PIX_PADRAO_SEG = 86_400;
export const PIX_MINIMO_SEG = 300;
export const PARCELAS_MAX = 12;
export const VALIDADES_LINK_DIAS = [1, 3, 7, 15, 30] as const;

/** Validade do Pix: 1 dia, sem passar do limite (horario ou fim do link), nunca menos de 5 min. */
export function validadePixSeg(limite: Date | number | null, agora = Date.now(), padrao = PIX_PADRAO_SEG) {
  const ate = limite === null ? Infinity : (typeof limite === "number" ? limite : limite.getTime()) - agora;
  return Math.max(PIX_MINIMO_SEG, Math.floor(Math.min(padrao, ate / 1000)));
}

/** Pix ja venceu (ou vence em menos de 1 min: nao adianta mostrar). */
export function pixVencido(expiraEm: Date | string | null | undefined, agora = Date.now()) {
  if (!expiraEm) return false;
  return new Date(expiraEm).getTime() - agora < 60_000;
}

/** Segundos que faltam (0 se ja passou). */
export function segundosRestantes(expiraEm: Date | string | null | undefined, agora = Date.now()) {
  if (!expiraEm) return null;
  return Math.max(0, Math.floor((new Date(expiraEm).getTime() - agora) / 1000));
}

/** 3725 -> "1h 02min"; 125 -> "02:05". */
export function formatarContagem(seg: number) {
  const s = Math.max(0, Math.floor(seg));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}min`;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

/** Parcelas pedidas pelo cliente dentro do permitido (null = invalido). */
export function parcelasValidas(pedidas: number | undefined, max: number) {
  const limite = Math.min(PARCELAS_MAX, Math.max(1, Math.floor(max)));
  const n = pedidas ?? 1;
  return Number.isInteger(n) && n >= 1 && n <= limite ? n : null;
}

/** Valor de cada parcela (centavos, arredondado para cima: a soma nunca fica abaixo do total). */
export const valorParcela = (totalCentavos: number, parcelas: number) => Math.ceil(totalCentavos / Math.max(1, parcelas));

type LinkRegra = { status: "PENDENTE" | "PAGO" | "CANCELADO" | "EXPIRADO" | "ESTORNADO"; expiraEm: Date; valorCentavos: number };

/** Situacao real do link (pendente com validade vencida conta como expirado). */
export function situacaoLink(l: Pick<LinkRegra, "status" | "expiraEm">, agora = Date.now()): LinkRegra["status"] {
  if (l.status === "PENDENTE" && l.expiraEm.getTime() <= agora) return "EXPIRADO";
  return l.status;
}

/** Motivo para o link nao poder ser pago agora (ou null). */
export function motivoLinkFechado(l: Pick<LinkRegra, "status" | "expiraEm">, agora = Date.now()) {
  switch (situacaoLink(l, agora)) {
    case "PAGO": return "Esse link já foi pago. ✅";
    case "ESTORNADO": return "Esse pagamento foi estornado. Fale com a barbearia.";
    case "CANCELADO": return "Esse link de pagamento foi cancelado. Fale com a barbearia.";
    case "EXPIRADO": return "Esse link de pagamento expirou. Peça um novo para a barbearia.";
    default: return null;
  }
}

/** Erro ao criar um link (ou null). Comanda: o valor nao pode passar do que falta. */
export function erroNovoLink(p: { valorCentavos: number; validadeDias: number; parcelasMax: number; faltaComanda?: number | null }) {
  if (!Number.isInteger(p.valorCentavos) || p.valorCentavos < 100) return "Informe um valor de pelo menos R$ 1,00.";
  if (p.valorCentavos > 5_000_000) return "Valor alto demais para um link (máximo R$ 50.000,00).";
  if (!Number.isInteger(p.validadeDias) || p.validadeDias < 1 || p.validadeDias > 30) return "A validade vai de 1 a 30 dias.";
  if (!Number.isInteger(p.parcelasMax) || p.parcelasMax < 1 || p.parcelasMax > PARCELAS_MAX) return "Parcelas de 1 a 12.";
  if (p.faltaComanda !== undefined && p.faltaComanda !== null) {
    if (p.faltaComanda <= 0) return "Essa comanda já está paga.";
    if (p.valorCentavos > p.faltaComanda) return "O valor é maior do que falta pagar na comanda.";
  }
  return null;
}

/** Pagamento da comanda criado pelo link (Pix ou credito). */
export const formaNaComanda = (forma: "PIX" | "CARTAO" | "BOLETO" | null) => (forma === "CARTAO" ? "CREDITO" : "PIX") as "PIX" | "CREDITO";

const reais = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Mensagem do WhatsApp com o link. */
export function textoEnvioLink(p: { nome: string; descricao: string; valorCentavos: number; url: string; expiraEm: Date; barbearia: string; fuso?: string }) {
  const primeiro = p.nome.trim().split(/\s+/)[0] || "tudo bem";
  const ate = p.expiraEm.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: p.fuso ?? "America/Sao_Paulo" });
  return `Oi, ${primeiro}! Segue o link para pagar ${p.descricao} (${reais(p.valorCentavos)}) na ${p.barbearia}, por Pix ou cartão: ${p.url}\nVale até ${ate}. 💈`;
}
