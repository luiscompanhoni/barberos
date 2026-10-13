/**
 * O que esta sendo estornado (pagamento da comanda, horario pago antes, link ou mensalidade),
 * carregado do banco num formato unico.
 */
import type { Prisma } from "@prisma/client";
import { resumoComanda } from "@/lib/comandas/regras";
import { db } from "@/lib/db";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import { formaFinanceira, meioDoEstorno, type FormaFinanceira, type MeioEstorno, type TipoEstorno } from "./regras";

type Leitor = Prisma.TransactionClient | typeof db;

export type Alvo = {
  tipo: TipoEstorno;
  referenciaId: string;
  valorOriginal: number;
  gatewayId: string | null;
  meio: MeioEstorno;
  forma: FormaFinanceira;
  descricao: string;
  clienteNome: string | null;
  comandaId: string | null;
  /** Pagamento da comanda ligado (o proprio, ou o lancamento do horario/link na comanda). */
  pagamentoComandaId: string | null;
  /** Liquido da comanda (pago - troco): o estorno nao passa dele. */
  liquidoComanda: number | null;
  /** Motivo para nao poder estornar (ou null). */
  bloqueio: string | null;
};

const ROTULO: Record<string, string> = { DINHEIRO: "Dinheiro", PIX: "Pix", DEBITO: "Débito", CREDITO: "Crédito", CARTAO: "Cartão" };
const incluirComanda = { include: { itens: true, pagamentos: true, cliente: { select: { nome: true } } } } as const;
type ComandaCompleta = Prisma.ComandaGetPayload<typeof incluirComanda>;
const liquido = (c: ComandaCompleta) => { const r = resumoComanda(c.itens, c.pagamentos, c.descontoCentavos); return r.pago - r.troco; };

/** Carrega o alvo. COMANDA de pagamento online vira o ANTECIPADO/LINK de origem. ANTECIPADO aceita o id do horario. */
export async function carregarAlvo(tipo: TipoEstorno, id: string, tx: Leitor = db): Promise<Alvo> {
  if (tipo === "COMANDA") {
    const pg = await tx.pagamentoComanda.findUnique({ where: { id }, include: { comanda: incluirComanda } });
    if (!pg) throw naoEncontrado("Pagamento");
    if (pg.antecipadoId) return carregarAlvo("ANTECIPADO", pg.antecipadoId, tx);
    if (pg.linkPagamentoId) return carregarAlvo("LINK", pg.linkPagamentoId, tx);
    const meio = meioDoEstorno({ tipo, gatewayId: pg.gatewayPedidoId, forma: pg.forma });
    return {
      tipo, referenciaId: pg.id, valorOriginal: pg.valorCentavos, gatewayId: pg.gatewayPedidoId, meio, forma: formaFinanceira(tipo, pg.forma),
      descricao: `Comanda #${pg.comanda.numero} · ${ROTULO[pg.forma] ?? pg.forma}`, clienteNome: pg.comanda.cliente?.nome ?? pg.comanda.nomeAvulso ?? null,
      comandaId: pg.comandaId, pagamentoComandaId: pg.id, liquidoComanda: liquido(pg.comanda),
      bloqueio: pg.status === "PAGO" ? null : pg.status === "AGUARDANDO" ? "Esse pagamento ainda está na maquininha: cancele em vez de estornar." : "Esse pagamento não está mais valendo.",
    };
  }
  if (tipo === "ANTECIPADO") {
    const inc = { include: { cliente: { select: { nome: true } }, agendamento: { include: { servico: { select: { nome: true } } } }, pagamentoComanda: { include: { comanda: incluirComanda } } } } as const;
    const a = (await tx.pagamentoAntecipado.findUnique({ where: { id }, ...inc })) ?? (await tx.pagamentoAntecipado.findUnique({ where: { agendamentoId: id }, ...inc }));
    if (!a) throw naoEncontrado("Pagamento do horário");
    const pc = a.pagamentoComanda;
    return {
      tipo, referenciaId: a.id, valorOriginal: a.valorCentavos, gatewayId: a.gatewayId, meio: meioDoEstorno({ tipo, gatewayId: a.gatewayId }), forma: "ONLINE",
      descricao: `Horário pago antes · ${a.agendamento.servico.nome}${pc ? ` (comanda #${pc.comanda.numero})` : ""}`, clienteNome: a.cliente.nome,
      comandaId: pc?.comandaId ?? null, pagamentoComandaId: pc?.id ?? null, liquidoComanda: pc ? liquido(pc.comanda) : null,
      bloqueio: a.status === "PAGO" ? null
        : a.status === "CREDITADO" ? "O horário foi cancelado e o valor virou saldo do cliente: não dá para estornar pelo sistema."
          : a.status === "ESTORNADO" ? "Esse pagamento já foi estornado." : "Esse horário não está pago.",
    };
  }
  if (tipo === "LINK") {
    const l = await tx.linkPagamento.findUnique({ where: { id }, include: { pagamentoComanda: { include: { comanda: incluirComanda } } } });
    if (!l) throw naoEncontrado("Link");
    const pc = l.pagamentoComanda;
    return {
      tipo, referenciaId: l.id, valorOriginal: l.valorCentavos, gatewayId: l.gatewayId, meio: meioDoEstorno({ tipo, gatewayId: l.gatewayId }), forma: "ONLINE",
      descricao: `Link de pagamento · ${l.descricao}${pc ? ` (comanda #${pc.comanda.numero})` : ""}`, clienteNome: l.nome,
      comandaId: pc?.comandaId ?? l.comandaId ?? null, pagamentoComandaId: pc?.id ?? null, liquidoComanda: pc ? liquido(pc.comanda) : null,
      bloqueio: l.status === "PAGO" ? null : l.status === "ESTORNADO" ? "Esse link já foi estornado." : "Esse link não foi pago.",
    };
  }
  const c = await tx.cobranca.findUnique({ where: { id }, include: { assinatura: { include: { cliente: { select: { nome: true } }, plano: { select: { nome: true } } } } } });
  if (!c) throw naoEncontrado("Mensalidade");
  return {
    tipo, referenciaId: c.id, valorOriginal: c.valorCentavos, gatewayId: c.gatewayId, meio: meioDoEstorno({ tipo, gatewayId: c.gatewayId }), forma: "ONLINE",
    descricao: `Mensalidade ${c.assinatura.plano.nome} · venc. ${c.vencimento.toISOString().slice(0, 10).split("-").reverse().join("/")}`,
    clienteNome: c.assinatura.cliente.nome, comandaId: null, pagamentoComandaId: null, liquidoComanda: null,
    bloqueio: c.status === "PAGA" ? null : c.status === "ESTORNADA" ? "Essa mensalidade já foi estornada." : "Essa mensalidade não está paga.",
  };
}

/** Erro pronto se o alvo nao pode ser estornado. */
export function exigirEstornavel(a: Alvo) {
  if (a.bloqueio) throw new ErroNegocio(a.bloqueio, 409, "nao_estornavel");
}
