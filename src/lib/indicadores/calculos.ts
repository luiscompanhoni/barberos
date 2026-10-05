/**
 * Contas puras dos indicadores (sem banco), testadas em tests/indicadores.test.ts.
 */
const DIA = 86_400_000;

/** Idade completa em anos numa data (AAAA-MM-DD). */
export function idade(nascimento: string, hoje: string) {
  const [an, mn, dn] = nascimento.split("-").map(Number);
  const [ah, mh, dh] = hoje.split("-").map(Number);
  return ah - an - (mh < mn || (mh === mn && dh < dn) ? 1 : 0);
}

export const FAIXAS_ETARIAS = ["até 17", "18–24", "25–34", "35–44", "45–54", "55+"] as const;
export function faixaEtaria(anos: number): (typeof FAIXAS_ETARIAS)[number] {
  if (anos < 18) return "até 17";
  if (anos < 25) return "18–24";
  if (anos < 35) return "25–34";
  if (anos < 45) return "35–44";
  if (anos < 55) return "45–54";
  return "55+";
}

export const FAIXAS_FREQUENCIA = ["Semanal (até 10 dias)", "Quinzenal (11–20)", "Mensal (21–40)", "Esporádico (40+)"] as const;
export function faixaFrequencia(dias: number): (typeof FAIXAS_FREQUENCIA)[number] {
  if (dias <= 10) return "Semanal (até 10 dias)";
  if (dias <= 20) return "Quinzenal (11–20)";
  if (dias <= 40) return "Mensal (21–40)";
  return "Esporádico (40+)";
}

/**
 * Intervalo medio entre visitas de cada cliente (so quem veio 2+ vezes).
 * `visitas`: instantes por cliente, em qualquer ordem.
 */
export function intervalosPorCliente(visitas: Map<string, number[]>) {
  const out = new Map<string, number>();
  for (const [id, vs] of visitas) {
    if (vs.length < 2) continue;
    const o = [...vs].sort((a, b) => a - b);
    out.set(id, (o.at(-1)! - o[0]) / (o.length - 1) / DIA);
  }
  return out;
}

export const media = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
export function mediana(xs: number[]) {
  if (!xs.length) return null;
  const o = [...xs].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
}

/**
 * Retorno de clientes novos: dos que vieram pela 1a vez, quantos voltaram em ate `janelaDias`.
 * `primeiraESegunda`: [primeira visita, segunda visita | null] por cliente.
 */
export function taxaDeRetorno(primeiraESegunda: [number, number | null][], janelaDias = 45) {
  if (!primeiraESegunda.length) return { base: 0, voltaram: 0, taxa: null as number | null };
  const voltaram = primeiraESegunda.filter(([a, b]) => b !== null && b - a <= janelaDias * DIA).length;
  return { base: primeiraESegunda.length, voltaram, taxa: voltaram / primeiraESegunda.length };
}

/** Churn do periodo levado para 30 dias (para comparar periodos de tamanhos diferentes). */
export function churnMensal(canceladas: number, ativasNoInicio: number, diasDoPeriodo: number) {
  if (!ativasNoInicio || diasDoPeriodo <= 0) return null;
  return Math.min(1, (canceladas / ativasNoInicio) * (30 / diasDoPeriodo));
}

/** Valor esperado de um assinante durante a vida dele (ticket mensal / churn mensal). */
export function ltv(ticketMensal: number, churn: number | null) {
  return churn && churn > 0 ? Math.round(ticketMensal / churn) : null;
}

/** Status da base pela ultima visita: ativo (ate 45 dias), em risco (46–90), perdido (90+). */
export function situacaoPelaUltimaVisita(ultima: number, agora: number): "ativo" | "risco" | "perdido" {
  const dias = (agora - ultima) / DIA;
  if (dias <= 45) return "ativo";
  if (dias <= 90) return "risco";
  return "perdido";
}
