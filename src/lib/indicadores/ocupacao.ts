/**
 * Ocupacao = minutos com cliente na cadeira / minutos de agenda aberta (expediente menos bloqueios).
 * Falta nao conta como ocupado (a cadeira ficou vazia); cancelado tambem nao.
 */
import { carregarDia, configuracao } from "@/lib/agenda/carregar";
import { subtrair, unir, type Intervalo } from "@/lib/agenda/disponibilidade";
import { dataLocal, diaSemana } from "@/lib/agenda/tempo";
import { db } from "@/lib/db";

const OCUPA = ["MARCADO", "CONFIRMADO", "CHEGOU", "EM_ATENDIMENTO", "CONCLUIDO"] as const;
const MIN = 60_000;

const soma = (ints: Intervalo[]) => ints.reduce((t, i) => t + (i.fim - i.inicio), 0) / MIN;
function sobreposicao(a: Intervalo[], b: Intervalo[]) {
  let t = 0;
  for (const x of a) for (const y of b) t += Math.max(0, Math.min(x.fim, y.fim) - Math.max(x.inicio, y.inicio));
  return t / MIN;
}

export type LinhaOcupacao = { capacidadeMin: number; ocupadoMin: number; taxa: number | null };
const linha = (cap: number, oc: number): LinhaOcupacao => ({ capacidadeMin: Math.round(cap), ocupadoMin: Math.round(oc), taxa: cap ? oc / cap : null });

/** Ocupacao por barbeiro, por dia e por dia da semana nos dias informados (ate hoje). */
export async function ocupacaoDosDias(todosOsDias: string[], barbeiroIds?: string[]) {
  const cfg = await configuracao();
  // Dias antes do primeiro atendimento registrado nao contam (o sistema ainda nao era usado).
  const primeiro = await db.agendamento.findFirst({ orderBy: { inicio: "asc" }, select: { inicio: true } });
  const inicioUso = primeiro ? dataLocal(primeiro.inicio, cfg.fuso) : null;
  const dias = inicioUso ? todosOsDias.filter((d) => d >= inicioUso) : [];
  const barbeiros = await db.barbeiro.findMany({
    where: barbeiroIds ? { id: { in: barbeiroIds } } : { ativo: true },
    orderBy: [{ ordem: "asc" }, { nome: "asc" }],
    select: { id: true, nome: true, cor: true },
  });
  const ids = barbeiros.map((b) => b.id);
  if (!dias.length || !ids.length) return { total: linha(0, 0), porBarbeiro: [], porDia: [], porDiaSemana: [] };

  const ags = await db.agendamento.findMany({
    where: { barbeiroId: { in: ids }, status: { in: [...OCUPA] }, inicio: { lt: new Date(Date.parse(`${dias.at(-1)}T23:59:59Z`) + 86_400_000) }, fim: { gt: new Date(Date.parse(`${dias[0]}T00:00:00Z`) - 86_400_000) } },
    select: { barbeiroId: true, inicio: true, fim: true },
  });
  const porChave = new Map<string, Intervalo[]>(); // barbeiro|data
  for (const a of ags) {
    const k = `${a.barbeiroId}|${dataLocal(a.inicio, cfg.fuso)}`;
    porChave.set(k, [...(porChave.get(k) ?? []), { inicio: +a.inicio, fim: +a.fim }]);
  }

  const capB = new Map<string, number>(), ocB = new Map<string, number>();
  const porDia: ({ data: string } & LinhaOcupacao)[] = [];
  const capS = new Array(7).fill(0), ocS = new Array(7).fill(0);
  for (const data of dias) {
    const mapa = await carregarDia(data, ids, { fuso: cfg.fuso });
    let capD = 0, ocD = 0;
    for (const id of ids) {
      const d = mapa.get(id)!;
      const trabalho = subtrair(d.janelas, d.bloqueios);
      const cap = soma(trabalho);
      const oc = sobreposicao(unir(porChave.get(`${id}|${data}`) ?? []), trabalho);
      capD += cap; ocD += oc;
      capB.set(id, (capB.get(id) ?? 0) + cap);
      ocB.set(id, (ocB.get(id) ?? 0) + oc);
    }
    porDia.push({ data, ...linha(capD, ocD) });
    const ds = diaSemana(data);
    capS[ds] += capD; ocS[ds] += ocD;
  }
  const capT = [...capB.values()].reduce((a, b) => a + b, 0);
  const ocT = [...ocB.values()].reduce((a, b) => a + b, 0);
  return {
    total: linha(capT, ocT),
    porBarbeiro: barbeiros.map((b) => ({ ...b, ...linha(capB.get(b.id) ?? 0, ocB.get(b.id) ?? 0) })),
    porDia,
    // segunda..domingo
    porDiaSemana: [1, 2, 3, 4, 5, 6, 0].map((ds) => ({ diaSemana: ds, ...linha(capS[ds], ocS[ds]) })),
  };
}
