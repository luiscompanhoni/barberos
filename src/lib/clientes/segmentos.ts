/**
 * Segmentos da base de clientes (regras puras, testadas em tests/segmentos.test.ts).
 */
const DIA = 86_400_000;

export const FAIXAS_VISITA = ["0–30 dias", "31–60 dias", "61–90 dias", "91–180 dias", "+180 dias", "Nunca veio"] as const;
export type FaixaVisita = (typeof FAIXAS_VISITA)[number];

/** Dias inteiros desde a ultima visita (null = nunca veio). */
export const diasDesde = (ultima: number | null, agora: number) => (ultima === null ? null : Math.floor((agora - ultima) / DIA));

/** Faixa pela quantidade de dias desde a ultima visita concluida. */
export function faixaUltimaVisita(dias: number | null): FaixaVisita {
  if (dias === null) return "Nunca veio";
  if (dias <= 30) return "0–30 dias";
  if (dias <= 60) return "31–60 dias";
  if (dias <= 90) return "61–90 dias";
  if (dias <= 180) return "91–180 dias";
  return "+180 dias";
}

/** Conta quantos clientes caem em cada faixa (todas as faixas aparecem, mesmo com zero). */
export function contarPorFaixa(dias: (number | null)[]) {
  const out = Object.fromEntries(FAIXAS_VISITA.map((f) => [f, 0])) as Record<FaixaVisita, number>;
  for (const d of dias) out[faixaUltimaVisita(d)]++;
  return out;
}

/** Nome para comparar cadastros (sem acento, maiuscula, pontuacao nem espaco duplo). */
export const nomeComparavel = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/**
 * Possiveis duplicados: o mesmo nome (com pelo menos nome e sobrenome) em telefones diferentes.
 * Nome de uma palavra so ("Lucas") repete demais para indicar a mesma pessoa.
 */
export function nomesRepetidos<C extends { nome: string }>(clientes: C[]) {
  const grupos = new Map<string, C[]>();
  for (const c of clientes) {
    const k = nomeComparavel(c.nome);
    if (k.split(" ").length < 2) continue;
    grupos.set(k, [...(grupos.get(k) ?? []), c]);
  }
  return [...grupos.values()].filter((g) => g.length > 1);
}
