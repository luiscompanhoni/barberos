/**
 * Regras puras da comanda (sem banco): totais, troco e o que pode ser pago/fechado.
 */
export type ItemRegra = { quantidade: number; precoUnitCentavos: number };
export type PagamentoRegra = {
  forma: "DINHEIRO" | "PIX" | "CREDITO" | "DEBITO"; valorCentavos: number; status: "AGUARDANDO" | "PAGO" | "CANCELADO";
  /** Parte ja devolvida por estorno (total = status CANCELADO com estornadoEm). */
  estornadoCentavos?: number; estornadoEm?: Date | string | null;
};

/** O dinheiro chegou a entrar (pago, mesmo que estornado depois). Desfeito sem estorno nao conta. */
export const foiRecebido = (p: Pick<PagamentoRegra, "status" | "estornadoEm">) => p.status === "PAGO" || (p.status === "CANCELADO" && !!p.estornadoEm);

export function resumoComanda(itens: ItemRegra[], pagamentos: PagamentoRegra[], descontoCentavos = 0) {
  const subtotal = itens.reduce((s, i) => s + i.quantidade * i.precoUnitCentavos, 0);
  const desconto = Math.min(Math.max(0, descontoCentavos), subtotal);
  const total = subtotal - desconto;
  const recebidos = pagamentos.filter(foiRecebido);
  const bruto = recebidos.reduce((s, p) => s + p.valorCentavos, 0);
  const estornado = recebidos.reduce((s, p) => s + (p.estornadoCentavos ?? 0), 0);
  // Pago = o que ficou com a barbearia (bruto menos estornos).
  const pago = bruto - estornado;
  const aguardando = pagamentos.filter((p) => p.status === "AGUARDANDO").reduce((s, p) => s + p.valorCentavos, 0);
  const falta = Math.max(0, total - pago - aguardando);
  // Troco so existe quando o excesso veio em dinheiro (calculado no bruto: o troco ja foi dado).
  const dinheiro = recebidos.filter((p) => p.forma === "DINHEIRO").reduce((s, p) => s + p.valorCentavos, 0);
  const troco = Math.min(Math.max(0, bruto - total), dinheiro);
  return { subtotal, desconto, total, pago, estornado, aguardando, falta, troco, podeFechar: aguardando === 0 && pago >= total };
}

/** Motivo pelo qual o pagamento nao pode ser lancado (ou null se pode). */
export function erroNoPagamento(forma: PagamentoRegra["forma"], valorCentavos: number, falta: number): string | null {
  if (!Number.isInteger(valorCentavos) || valorCentavos <= 0) return "Informe um valor maior que zero.";
  if (falta <= 0) return "A comanda já está paga.";
  // Cartao e Pix cobram o valor exato; so dinheiro pode passar (gera troco).
  if (forma !== "DINHEIRO" && valorCentavos > falta) return "Valor maior do que falta pagar. Só em dinheiro dá para receber a mais (troco).";
  return null;
}

/** Saldo depois do movimento e se ficou abaixo do minimo (para avisar a reposicao). */
export function saldoDepois(estoque: number, quantidade: number, minimo: number) {
  const saldo = estoque + quantidade;
  return { saldo, baixo: saldo <= minimo, negativo: saldo < 0 };
}

/** Texto do item de servico vindo da agenda. */
export function descricaoServico(servico: string, barbeiro: string, peloPlano: boolean) {
  return `${servico} com ${barbeiro}${peloPlano ? " (plano)" : ""}`;
}

/** Cashback em centavos (arredonda para baixo; abaixo de 1 centavo nao gera nada). */
export function valorCashback(totalCentavos: number, pct: number) {
  if (totalCentavos <= 0 || pct <= 0) return 0;
  return Math.floor((totalCentavos * Math.min(pct, 100)) / 100);
}
