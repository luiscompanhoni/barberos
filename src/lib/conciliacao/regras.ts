/**
 * Regras puras da conciliacao: como cada movimento do extrato da Celcash vira um tipo (recebimento, taxa,
 * antecipacao, estorno, transferencia entre contas proprias, pagamento a terceiro, tarifa) e o resultado do mes.
 */

export type TipoExterno = "RECEBIMENTO" | "TAXA" | "ANTECIPACAO" | "ESTORNO" | "TRANSFERENCIA" | "PAGAMENTO" | "TARIFA" | "OUTRO";

/** Movimento como vem de GET /company/balance/movements. */
export type MovimentoCelcash = {
  galaxPayId: number;
  value: number;
  friendlyDescription: string;
  createdAt: string;
  groupPaymentType: string;
  paymentType: string;
  transactionGalaxPayId?: number | null;
};

const normalizar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();

/** Nome de quem recebeu/enviou o Pix ("PIX enviado para: Fulano" -> "Fulano"). */
export function contraparte(descricao: string) {
  const m = descricao.match(/PIX (?:enviado para|recebido de):\s*(.+)$/i);
  return m ? m[1].trim() : null;
}

/** E conta da propria empresa? (o nome comeca com um dos cadastrados, sem acento/caixa). */
export function ehContaPropria(nome: string | null, contasProprias: string[]) {
  if (!nome) return false;
  const n = normalizar(nome);
  return contasProprias.some((c) => c.trim() && n.startsWith(normalizar(c)));
}

/** Classifica um movimento da Celcash. */
export function classificarCelcash(m: MovimentoCelcash, contasProprias: string[]): { tipo: TipoExterno; forma: string | null } {
  const g = m.groupPaymentType;
  const p = m.paymentType;
  const forma = g === "subacquirer" ? "CARTAO" : g === "boleto" ? (p.toLowerCase().includes("pix") ? "PIX" : "BOLETO") : g.toLowerCase().includes("pix") ? "PIX" : null;

  if (p === "subacquirerDebitTaxAntecipation") return { tipo: "ANTECIPACAO", forma };
  if (p === "subacquirerReversal" || p.toLowerCase().includes("chargeback") || p.toLowerCase().includes("reversal")) return { tipo: "ESTORNO", forma };
  if (g === "mensality" || g === "purchaseModule" || g === "notificationWhatsapp" || p.toLowerCase().includes("notification")) return { tipo: "TARIFA", forma: null };
  if (p.toLowerCase().includes("tax")) return { tipo: "TAXA", forma };

  // Pix enviado/recebido de conta: da propria empresa e transferencia; para terceiro e pagamento.
  if (g === "paymentPix" || g === "returnPix") {
    const quem = contraparte(m.friendlyDescription);
    if (ehContaPropria(quem, contasProprias)) return { tipo: "TRANSFERENCIA", forma: "PIX" };
    return m.value < 0 ? { tipo: "PAGAMENTO", forma: "PIX" } : { tipo: "RECEBIMENTO", forma: "PIX" };
  }
  if (m.value > 0 && (p.toLowerCase().includes("credit") || p === "credit")) return { tipo: "RECEBIMENTO", forma };
  return { tipo: "OUTRO", forma };
}

/** "R$ 12,34" -> centavos, com sinal (o extrato vem em reais com casas decimais). */
export const paraCentavos = (reais: number) => Math.round(reais * 100);

export type Linha = { tipo: TipoExterno; forma: string | null; valorCentavos: number; categoria: string | null };

/**
 * Resumo do extrato no mes: recebido por forma, taxas (transacao + antecipacao + tarifas), estornos,
 * transferencias para as contas da empresa e pagamentos a terceiros (com e sem categoria).
 */
export function resumirExtrato(linhas: Linha[]) {
  const soma = (f: (l: Linha) => boolean) => linhas.filter(f).reduce((t, l) => t + l.valorCentavos, 0);
  const recebidoPorForma: Record<string, number> = {};
  for (const l of linhas) if (l.tipo === "RECEBIMENTO") recebidoPorForma[l.forma ?? "OUTRO"] = (recebidoPorForma[l.forma ?? "OUTRO"] ?? 0) + l.valorCentavos;
  const recebido = soma((l) => l.tipo === "RECEBIMENTO");
  const taxas = -soma((l) => l.tipo === "TAXA");
  const antecipacao = -soma((l) => l.tipo === "ANTECIPACAO");
  const tarifas = -soma((l) => l.tipo === "TARIFA");
  const estornos = -soma((l) => l.tipo === "ESTORNO");
  return {
    recebido, recebidoPorForma, taxas, antecipacao, tarifas, estornos,
    custoGateway: taxas + antecipacao + tarifas,
    liquido: recebido - taxas - antecipacao - tarifas - estornos,
    transferidoParaEmpresa: -soma((l) => l.tipo === "TRANSFERENCIA" && l.valorCentavos < 0),
    voltouDaEmpresa: soma((l) => l.tipo === "TRANSFERENCIA" && l.valorCentavos > 0),
    pagamentos: -soma((l) => l.tipo === "PAGAMENTO"),
    pagamentosSemCategoria: -soma((l) => l.tipo === "PAGAMENTO" && !l.categoria),
    outros: soma((l) => l.tipo === "OUTRO"),
  };
}

/** Diferenca relevante (acima de R$ 1 e de 1%) entre o registrado e o que caiu. */
export function divergente(registrado: number, caiu: number) {
  const d = Math.abs(registrado - caiu);
  return d > 100 && d > Math.abs(registrado) * 0.01;
}
