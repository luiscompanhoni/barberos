/**
 * Segmentos da base de clientes (regras puras, testadas em tests/segmentos.test.ts).
 */
const DIA = 86_400_000;

export const TEMPERATURAS = ["quente", "morno", "frio", "muitoFrio"] as const;
export type TemperaturaCliente = typeof TEMPERATURAS[number] | "semVisitaRegistrada" | "historicoIncompleto";
export const LIMITE_VISITA = { quente: 30, morno: 90, frio: 180 } as const;
export const ROTULO_TEMPERATURA: Record<TemperaturaCliente, string> = {
  quente: `Quente · até ${LIMITE_VISITA.quente} dias`,
  morno: `Morno · ${LIMITE_VISITA.quente + 1} a ${LIMITE_VISITA.morno} dias`,
  frio: `Frio · ${LIMITE_VISITA.morno + 1} a ${LIMITE_VISITA.frio} dias`,
  muitoFrio: `Muito frio · mais de ${LIMITE_VISITA.frio} dias`,
  semVisitaRegistrada: "Sem visita registrada",
  historicoIncompleto: "Histórico incompleto",
};

/** Temperatura mede visita, não adimplência ou autorização de contato. */
export function temperaturaDoCliente(ultima: number | null, agora: number, historicoCompleto = true): TemperaturaCliente {
  if (!historicoCompleto || !Number.isFinite(agora) || (ultima !== null && (!Number.isFinite(ultima) || ultima > agora))) return "historicoIncompleto";
  if (ultima === null) return "semVisitaRegistrada";
  const dias = diasDesde(ultima, agora)!;
  return dias <= LIMITE_VISITA.quente ? "quente" : dias <= LIMITE_VISITA.morno ? "morno" : dias <= LIMITE_VISITA.frio ? "frio" : "muitoFrio";
}

export function rotuloDaUltimaVisita(iso: string) {
  return ROTULO_TEMPERATURA[temperaturaDoCliente(Date.parse(iso), Date.now())];
}

export const FAIXAS_VISITA = ["0–30 dias", "31–60 dias", "61–90 dias", "91–180 dias", "+180 dias", "Nunca veio"] as const;
export type FaixaVisita = (typeof FAIXAS_VISITA)[number];

/** Dias inteiros desde a ultima visita (null = nunca veio). */
export const diasDesde = (ultima: number | null, agora: number) => (ultima === null ? null : Math.floor((agora - ultima) / DIA));

/** Faixa pela quantidade de dias desde a ultima visita concluida. */
export function faixaUltimaVisita(dias: number | null): FaixaVisita {
  if (dias === null) return "Nunca veio";
  if (dias <= LIMITE_VISITA.quente) return "0–30 dias";
  if (dias <= 60) return "31–60 dias";
  if (dias <= LIMITE_VISITA.morno) return "61–90 dias";
  if (dias <= LIMITE_VISITA.frio) return "91–180 dias";
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
