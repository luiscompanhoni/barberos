/**
 * Motor de disponibilidade: funcoes puras, sem banco, para serem testadas a fundo.
 *
 * Horarios livres = (semana padrao OU excecao da data) - bloqueios - agendamentos,
 * respeitando duracao do servico, intervalo entre clientes, antecedencia minima e
 * a grade (ex.: de 15 em 15 minutos).
 */
import { diaSemana, instanteLocal } from "./tempo";

/** Intervalo semiaberto [inicio, fim) em ms UTC. */
export type Intervalo = { inicio: number; fim: number };

/** Intervalo em minutos do dia local. */
export type IntervaloMin = { inicioMin: number; fimMin: number };

export type ExcecaoDia =
  | { tipo: "FOLGA" }
  | { tipo: "HORARIO_ESPECIAL"; intervalos: IntervaloMin[] };

const MIN = 60_000;

/** Intervalos de trabalho do barbeiro numa data, ja em instantes UTC. */
export function janelasDeTrabalho(
  data: string,
  expedienteSemana: (IntervaloMin & { diaSemana: number })[],
  excecao: ExcecaoDia | null,
  fuso?: string,
): Intervalo[] {
  let base: IntervaloMin[];
  if (excecao?.tipo === "FOLGA") return [];
  if (excecao?.tipo === "HORARIO_ESPECIAL") {
    base = excecao.intervalos;
  } else {
    const ds = diaSemana(data);
    base = expedienteSemana.filter((e) => e.diaSemana === ds);
  }
  return unir(
    base
      .filter((i) => i.fimMin > i.inicioMin)
      .map((i) => ({
        inicio: instanteLocal(data, i.inicioMin, fuso),
        fim: instanteLocal(data, i.fimMin, fuso),
      })),
  );
}

/** Ordena e junta intervalos que se tocam ou se sobrepoem. */
export function unir(intervalos: Intervalo[]): Intervalo[] {
  const ord = [...intervalos].filter((i) => i.fim > i.inicio).sort((a, b) => a.inicio - b.inicio);
  const out: Intervalo[] = [];
  for (const i of ord) {
    const ult = out[out.length - 1];
    if (ult && i.inicio <= ult.fim) ult.fim = Math.max(ult.fim, i.fim);
    else out.push({ ...i });
  }
  return out;
}

/** base - ocupados */
export function subtrair(base: Intervalo[], ocupados: Intervalo[]): Intervalo[] {
  const occ = unir(ocupados);
  const out: Intervalo[] = [];
  for (const b of unir(base)) {
    let cursor = b.inicio;
    for (const o of occ) {
      if (o.fim <= cursor || o.inicio >= b.fim) continue;
      if (o.inicio > cursor) out.push({ inicio: cursor, fim: o.inicio });
      cursor = Math.max(cursor, o.fim);
      if (cursor >= b.fim) break;
    }
    if (cursor < b.fim) out.push({ inicio: cursor, fim: b.fim });
  }
  return out;
}

export function sobrepoe(a: Intervalo, b: Intervalo): boolean {
  return a.inicio < b.fim && b.inicio < a.fim;
}

/** `dentro` esta inteiramente contido em algum intervalo de `janelas`. */
export function contido(dentro: Intervalo, janelas: Intervalo[]): boolean {
  return unir(janelas).some((j) => dentro.inicio >= j.inicio && dentro.fim <= j.fim);
}

export type ParametrosHorarios = {
  janelas: Intervalo[];
  bloqueios: Intervalo[];
  agendamentos: Intervalo[];
  duracaoMin: number;
  granularidadeMin: number;
  intervaloEntreClientesMin: number;
  /** Nenhum horario comeca antes deste instante (agora + antecedencia minima). */
  naoAntesDe: number;
};

/** Inicios possiveis (ms UTC) para um servico de `duracaoMin`. */
export function horariosLivres(p: ParametrosHorarios): number[] {
  const dur = p.duracaoMin * MIN;
  const passo = p.granularidadeMin * MIN;
  const folga = p.intervaloEntreClientesMin * MIN;
  if (dur <= 0 || passo <= 0) return [];

  // O intervalo entre clientes "alarga" cada atendimento existente dos dois lados.
  const ocupados = [
    ...p.bloqueios,
    ...p.agendamentos.map((a) => ({ inicio: a.inicio - folga, fim: a.fim + folga })),
  ];
  const livres = subtrair(p.janelas, ocupados);

  const out: number[] = [];
  for (const l of livres) {
    let s = Math.max(l.inicio, p.naoAntesDe);
    s = Math.ceil(s / passo) * passo; // alinha na grade (00, 15, 30, 45)
    for (; s + dur <= l.fim; s += passo) out.push(s);
  }
  return out;
}
