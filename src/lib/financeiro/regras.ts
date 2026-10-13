/**
 * Regras puras do financeiro: caixa, conciliacao, despesas, extrato e resumo do mes.
 */

export const FORMAS_CONCILIACAO = ["PIX", "DEBITO", "CREDITO", "ONLINE"] as const;
export type FormaConciliacao = (typeof FORMAS_CONCILIACAO)[number];

export const ROTULO_FORMA: Record<string, string> = {
  DINHEIRO: "Dinheiro", PIX: "Pix (maquininha/QR)", DEBITO: "Débito", CREDITO: "Crédito", ONLINE: "Online (link Celcash)",
};

/** Dinheiro que deveria estar na gaveta. */
export function dinheiroEsperado(p: { fundo: number; recebidoDinheiro: number; troco: number; suprimentos: number; sangrias: number }) {
  return p.fundo + p.recebidoDinheiro - p.troco + p.suprimentos - p.sangrias;
}

export type PagamentoResumo = { forma: string; valorCentavos: number; online: boolean };

/** Total por forma. Pagamento feito antes pelo link conta como ONLINE (nao passa na maquininha). */
export function totaisPorForma(pagamentos: PagamentoResumo[]) {
  const t: Record<string, number> = { DINHEIRO: 0, PIX: 0, DEBITO: 0, CREDITO: 0, ONLINE: 0 };
  for (const p of pagamentos) t[p.online ? "ONLINE" : p.forma] = (t[p.online ? "ONLINE" : p.forma] ?? 0) + p.valorCentavos;
  return t;
}

/** Taxa (em centesimos de %) sobre o bruto, arredondada para o centavo. */
export const taxaSobre = (bruto: number, taxaBps: number) => Math.round((bruto * taxaBps) / 10_000);

/** Data prevista do deposito (D+N corridos) a partir de AAAA-MM-DD. */
export function dataPrevista(data: string, prazoDias: number) {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + prazoDias);
  return d.toISOString().slice(0, 10);
}

/** Situacao da linha da conciliacao. Tolerancia de 1 centavo por arredondamento. */
export function situacaoConciliacao(liquido: number, recebido: number | null) {
  if (recebido === null) return "PENDENTE" as const;
  return Math.abs(recebido - liquido) <= 1 ? ("CONFERIDO" as const) : ("DIVERGENTE" as const);
}

// ------------------------------------------------------------------ Despesas (contas a pagar)

export const CATEGORIAS_DESPESA = [
  "ALUGUEL", "ENERGIA", "AGUA", "INTERNET", "PRODUTOS", "BAR", "FORNECEDOR", "FOLHA", "COMISSAO", "MARKETING", "IMPOSTOS", "MANUTENCAO", "OUTROS",
] as const;
export type CategoriaDespesa = (typeof CATEGORIAS_DESPESA)[number];

export const ROTULO_CATEGORIA: Record<string, string> = {
  ALUGUEL: "Aluguel", ENERGIA: "Energia", AGUA: "Água", INTERNET: "Internet", PRODUTOS: "Produtos", BAR: "Bar", FORNECEDOR: "Fornecedor",
  FOLHA: "Folha", COMISSAO: "Comissão", MARKETING: "Marketing", IMPOSTOS: "Impostos", MANUTENCAO: "Manutenção", OUTROS: "Outros",
};

export const FORMAS_DESPESA = ["DINHEIRO_CAIXA", "PIX", "TRANSFERENCIA", "BOLETO", "CARTAO"] as const;
export type FormaDespesa = (typeof FORMAS_DESPESA)[number];

export const ROTULO_FORMA_DESPESA: Record<string, string> = {
  DINHEIRO_CAIXA: "Dinheiro do caixa", PIX: "Pix", TRANSFERENCIA: "Transferência", BOLETO: "Boleto", CARTAO: "Cartão",
};

/** Mesmo dia no mes seguinte (AAAA-MM-DD); dia 31 vira o ultimo dia do mes quando ele e menor. */
export function proximoVencimento(data: string) {
  const [a, m, d] = data.split("-").map(Number);
  const ano = m === 12 ? a + 1 : a;
  const mes = m === 12 ? 1 : m + 1;
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return `${ano}-${String(mes).padStart(2, "0")}-${String(Math.min(d, ultimo)).padStart(2, "0")}`;
}

export type DespesaResumo = { categoria: string; valorCentavos: number; status: "PENDENTE" | "PAGA"; vencimento: string; pagoEm: string | null };

/** PAGA, VENCIDA (pendente com vencimento antes de hoje) ou ABERTA. Datas AAAA-MM-DD locais. */
export function situacaoDespesa(d: Pick<DespesaResumo, "status" | "vencimento">, hoje: string) {
  if (d.status === "PAGA") return "PAGA" as const;
  return d.vencimento < hoje ? ("VENCIDA" as const) : ("ABERTA" as const);
}

/** Totais da lista: a pagar (pendentes), vencidas, pagas no mes (AAAA-MM) e por categoria. `pagoEm` em data local. */
export function totaisDespesas(lista: DespesaResumo[], hoje: string, mes: string) {
  const t = { aPagar: 0, vencidas: 0, qtdVencidas: 0, pagasNoMes: 0, porCategoria: {} as Record<string, { aberto: number; pago: number }> };
  for (const d of lista) {
    const cat = (t.porCategoria[d.categoria] ??= { aberto: 0, pago: 0 });
    if (d.status === "PENDENTE") {
      t.aPagar += d.valorCentavos;
      cat.aberto += d.valorCentavos;
      if (situacaoDespesa(d, hoje) === "VENCIDA") { t.vencidas += d.valorCentavos; t.qtdVencidas++; }
    } else if (d.pagoEm?.startsWith(mes)) {
      t.pagasNoMes += d.valorCentavos;
      cat.pago += d.valorCentavos;
    }
  }
  return t;
}

// ------------------------------------------------------------------ Extrato do caixa

export type TipoLinhaExtrato = "ABERTURA" | "PAGAMENTO" | "TROCO" | "SANGRIA" | "SUPRIMENTO" | "DESPESA" | "ESTORNO" | "FECHAMENTO";
export type EventoExtrato = {
  tipo: TipoLinhaExtrato; em: Date; descricao: string;
  /** Valor da linha (sempre positivo; o sentido vem do tipo). */
  valorCentavos: number;
  /** So o que e dinheiro fisico mexe no saldo da gaveta. */
  dinheiro: boolean;
  forma?: string | null; comanda?: number | null; cliente?: string | null; online?: boolean;
  contado?: number | null; esperado?: number | null; diferenca?: number | null;
};
export type LinhaExtrato = EventoExtrato & { entrada: boolean; efeitoCentavos: number; saldoCentavos: number };

const ORDEM_TIPO: Record<TipoLinhaExtrato, number> = { ABERTURA: 0, PAGAMENTO: 1, TROCO: 2, SUPRIMENTO: 3, SANGRIA: 3, DESPESA: 3, ESTORNO: 3, FECHAMENTO: 9 };
const SAIDAS: TipoLinhaExtrato[] = ["TROCO", "SANGRIA", "DESPESA", "ESTORNO"];

/** Ordena os eventos e calcula o saldo de dinheiro na gaveta linha a linha. */
export function montarExtrato(eventos: EventoExtrato[]): LinhaExtrato[] {
  const ordenados = [...eventos].sort((a, b) => {
    // Abertura sempre primeiro e fechamento sempre por ultimo, mesmo com horario igual.
    if (a.tipo === "ABERTURA" || b.tipo === "FECHAMENTO") return a.tipo === b.tipo ? 0 : -1;
    if (b.tipo === "ABERTURA" || a.tipo === "FECHAMENTO") return 1;
    return +a.em - +b.em || ORDEM_TIPO[a.tipo] - ORDEM_TIPO[b.tipo];
  });
  let saldo = 0;
  return ordenados.map((e) => {
    const entrada = !SAIDAS.includes(e.tipo);
    const efeito = e.tipo === "FECHAMENTO" || !e.dinheiro ? 0 : entrada ? e.valorCentavos : -e.valorCentavos;
    saldo += efeito;
    return { ...e, entrada, efeitoCentavos: efeito, saldoCentavos: saldo };
  });
}

// ------------------------------------------------------------------ Resumo do mes

/** "AAAA-MM" do mes anterior. */
export function mesAnterior(mes: string) {
  const [a, m] = mes.split("-").map(Number);
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, "0")}`;
}

/** Dias (AAAA-MM-DD) do mes. */
export function diasDoMes(mes: string) {
  const [a, m] = mes.split("-").map(Number);
  const n = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${mes}-${String(i + 1).padStart(2, "0")}`);
}

/** Receita x despesa por dia do mes, a partir de lancamentos com data local. */
export function serieDiaria(mes: string, receitas: { data: string; valor: number }[], despesas: { data: string; valor: number }[]) {
  const mapa = new Map(diasDoMes(mes).map((d) => [d, { dia: d, receita: 0, despesa: 0 }]));
  for (const r of receitas) { const x = mapa.get(r.data); if (x) x.receita += r.valor; }
  for (const d of despesas) { const x = mapa.get(d.data); if (x) x.despesa += d.valor; }
  return [...mapa.values()];
}

/** Variacao percentual (null quando o anterior e zero). */
export const variacao = (atual: number, anterior: number) => (anterior === 0 ? null : Math.round(((atual - anterior) / Math.abs(anterior)) * 1000) / 10);
