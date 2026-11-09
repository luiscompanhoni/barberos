import type { Assinatura, ReservaCreditoAssinatura } from "@prisma/client";
import { dataLocal } from "@/lib/agenda/tempo";
import { valorComRetencao } from "@/lib/assinaturas/retencao-regras";
import { ErroNegocio } from "@/lib/erros";

export const creditosMensalidadeAtivos = () => process.env.CREDITOS_MENSALIDADE_ATIVOS === "true";
export const diaCredito = (data: Date) => data.toISOString().slice(0, 10);
export const revisaoCredito = () => new ErroNegocio("A recepção precisa conferir o crédito desta mensalidade. Nenhum novo pagamento deve ser feito por esta solicitação.", 409, "credito_gerencia");

export function conferirAssinaturaCredito(a: Assinatura, agora = new Date()) {
  if (a.status !== "ATIVA" || a.pausadaEm || a.encerraEm || a.operacaoInicial || !a.gatewayId || !a.gatewayClienteId || !a.proximoVencimento || diaCredito(a.proximoVencimento) <= dataLocal(agora)) throw revisaoCredito();
  return valorComRetencao({ precoCentavos: a.precoCentavos, vencimento: diaCredito(a.proximoVencimento), pct: a.descontoRetencaoPct, ate: a.descontoRetencaoAte ? diaCredito(a.descontoRetencaoAte) : null });
}

export type ProvaCobrancaCredito = {
  id: string; assinaturaGatewayId: string; clienteGatewayId: string;
  valorCentavos: number; vencimento: string; moeda: string; descontoId?: string;
  status: "PENDENTE" | "PAGA"; pagoEm: string | null; liquidadoCentavos?: number;
};

export function conferirProvaCredito(r: ReservaCreditoAssinatura, a: Assinatura, c: { gatewayId: string; valorCentavos: number; vencimento: Date; assinaturaId: string }, p: ProvaCobrancaCredito) {
  if (c.assinaturaId !== r.assinaturaId || a.id !== r.assinaturaId || p.id !== c.gatewayId || p.assinaturaGatewayId !== a.gatewayId || p.clienteGatewayId !== a.gatewayClienteId || p.moeda !== "BRL" || p.vencimento !== diaCredito(r.vencimento) || diaCredito(c.vencimento) !== p.vencimento || p.valorCentavos !== c.valorCentavos || p.valorCentavos !== r.valorMensalidadeCentavos - r.valorCentavos || p.valorCentavos <= 0 || !Number.isSafeInteger(p.valorCentavos) || (r.gatewayDescontoId && p.descontoId !== r.gatewayDescontoId)) throw revisaoCredito();
  if (!["PENDENTE", "PAGA"].includes(p.status) || (p.status === "PAGA" && (!p.pagoEm || !Number.isFinite(Date.parse(p.pagoEm)) || p.liquidadoCentavos !== p.valorCentavos))) throw revisaoCredito();
}

type Registro = Record<string, unknown>;
export function registro(x: unknown): Registro {
  if (!x || typeof x !== "object" || Array.isArray(x)) throw revisaoCredito();
  return x as Registro;
}
export function lista(x: unknown): unknown[] {
  if (!Array.isArray(x)) throw revisaoCredito();
  return x;
}

/** Somente campos monetários explícitos; ausência não vira fallback local. */
export function conferirSnapshotRemoto(a: Assinatura, assinatura: unknown, faturas: unknown, descontoId?: string, descontoCentavos?: number) {
  const s = registro(assinatura), cliente = registro(s.customer), fs = registro(faturas), pagina = registro(fs.paging);
  if (s.id !== a.gatewayId || s.status !== "active" || s.currency !== "BRL" || cliente.id !== a.gatewayClienteId || typeof s.next_billing_at !== "string" || s.next_billing_at.slice(0, 10) !== diaCredito(a.proximoVencimento!) || s.interval !== "month" || s.interval_count !== 1 || s.billing_type !== "prepaid") throw revisaoCredito();
  const itens = lista(s.items);
  if (!itens.length || itens.reduce<number>((total, item) => {
    const i = registro(item), preco = registro(i.pricing_scheme);
    if (preco.scheme_type !== "unit" || !Number.isSafeInteger(preco.price) || Number(preco.price) < 0 || !Number.isSafeInteger(i.quantity) || Number(i.quantity) <= 0) throw revisaoCredito();
    return total + Number(preco.price) * Number(i.quantity);
  }, 0) !== a.precoCentavos) throw revisaoCredito();
  if (lista(s.increments).some((x) => registro(x).status !== "deleted")) throw revisaoCredito();
  const descontos = lista(s.discounts).map(registro).filter((x) => x.status !== "deleted");
  if (!descontoId && descontos.length) throw revisaoCredito();
  if (descontoId && (descontos.length !== 1 || descontos[0].id !== descontoId || descontos[0].value !== descontoCentavos || descontos[0].discount_type !== "flat" || descontos[0].cycles !== 1 || descontos[0].status !== "active")) throw revisaoCredito();
  const dados = lista(fs.data);
  if (pagina.total !== dados.length || pagina.next) throw revisaoCredito();
  for (const item of dados) {
    const f = registro(item), titular = f.subscription_id ?? registro(f.subscription).id;
    if (titular !== a.gatewayId || typeof f.due_at !== "string" || !["paid", "canceled"].includes(String(f.status)) || f.due_at.slice(0, 10) === diaCredito(a.proximoVencimento!)) throw revisaoCredito();
  }
  return { vencimento: s.next_billing_at.slice(0, 10), precoCentavos: a.precoCentavos };
}
