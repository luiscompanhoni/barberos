import { ErroNegocio } from "@/lib/erros";
import { foiRecebido, resumoComanda, type ItemRegra, type PagamentoRegra } from "./regras";

type LinkReservado = { status?: string; valorCentavos: number; expiraEm: Date; gatewayId: string | null; tentativaChave: string | null };
type ComandaReservada = { itens: ItemRegra[]; pagamentos: PagamentoRegra[]; descontoCentavos: number; linksPagamento: LinkReservado[] };

/** Dinheiro pode gerar troco; cartão/Pix e ordens ainda em voo não podem exceder o novo total. */
export function valoresProtegidos(c: ComandaReservada, agora = Date.now()) {
  const recebidoNaoDinheiro = c.pagamentos.filter(p => foiRecebido(p) && p.forma !== "DINHEIRO")
    .reduce((s, p) => s + Math.max(0, p.valorCentavos - (p.estornadoCentavos ?? 0)), 0);
  const posPendente = c.pagamentos.filter(p => p.status === "AGUARDANDO").reduce((s, p) => s + p.valorCentavos, 0);
  const links = c.linksPagamento.filter(l => (!l.status || l.status === "PENDENTE") && (l.expiraEm.getTime() > agora || !!l.gatewayId || !!l.tentativaChave));
  const linkPendente = links.reduce((s, l) => s + l.valorCentavos, 0);
  return { recebidoNaoDinheiro, posPendente, linkPendente, piso: recebidoNaoDinheiro + posPendente + linkPendente, linkEmVoo: links.some(l => !!l.gatewayId || !!l.tentativaChave) };
}

/** Chamar com itens/pagamentos/links relidos sob a trava da comanda. */
export function conferirNovoTotal(c: ComandaReservada, itens: ItemRegra[], descontoCentavos: number) {
  const novoTotal = resumoComanda(itens, c.pagamentos, descontoCentavos).total;
  if (novoTotal < valoresProtegidos(c).piso) throw new ErroNegocio("O novo total ficaria abaixo dos valores já recebidos em cartão/Pix ou reservados. Confira/cancele as cobranças pendentes ou concilie o estorno antes de reduzir a comanda.", 409, "total_reservado");
}

export function conferirFechamentoReservado(c: ComandaReservada) {
  conferirLinkEmVoo(c);
  const p = valoresProtegidos(c);
  if (p.recebidoNaoDinheiro > resumoComanda(c.itens, c.pagamentos, c.descontoCentavos).total) throw new ErroNegocio("O valor recebido em cartão/Pix excede o total da comanda. A gerência precisa conciliar a cobrança antes de fechar.", 409, "recebimento_excedente");
}

export function conferirLinkEmVoo(c: ComandaReservada) {
  if (valoresProtegidos(c).linkEmVoo) throw new ErroNegocio("Há pagamento por link em processamento ou conferência. Aguarde a confirmação antes de encerrar a comanda.", 409, "link_pendente");
}
