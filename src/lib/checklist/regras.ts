/**
 * Regras puras do checklist da equipe (tarefas do dia e textos do WhatsApp).
 */

export type TarefaRegra = { id: string; titulo: string; funcao: string; diasSemana: number[]; horario: string | null; ordem: number; ativo: boolean };

/** Tarefas que valem para a funcao naquele dia da semana (lista vazia = todo dia), em ordem de horario. */
export function tarefasDoDia<T extends TarefaRegra>(tarefas: T[], funcao: string, diaSemana: number) {
  return tarefas
    .filter((t) => t.ativo && t.funcao === funcao && (t.diasSemana.length === 0 || t.diasSemana.includes(diaSemana)))
    .sort((a, b) => (a.horario ?? "99:99").localeCompare(b.horario ?? "99:99") || a.ordem - b.ordem);
}

export const hhmmParaMinutos = (h: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(h.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};

const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

export function textoLista(p: { nome: string; data: string; diaSemana: number; itens: { titulo: string; horario: string | null }[]; link: string }) {
  const [, m, d] = p.data.split("-");
  const linhas = p.itens.map((i, n) => `${n + 1}. ${i.horario ? `${i.horario} · ` : ""}${i.titulo}`);
  return `Bom dia, ${p.nome.split(" ")[0]}! ☀️\nSuas tarefas de hoje (${DIAS[p.diaSemana]}, ${d}/${m}):\n\n${linhas.join("\n")}\n\nMarque o que for terminando aqui: ${p.link}`;
}

export function textoResumo(p: { data: string; feitas: number; total: number; pendentes: { nome: string; titulo: string }[]; link: string }) {
  const [, m, d] = p.data.split("-");
  if (!p.total) return null;
  if (!p.pendentes.length) return `✅ Checklist de ${d}/${m}: todas as ${p.total} tarefas foram feitas. Boa, equipe!`;
  const porPessoa = new Map<string, string[]>();
  for (const x of p.pendentes) porPessoa.set(x.nome, [...(porPessoa.get(x.nome) ?? []), x.titulo]);
  const blocos = [...porPessoa].map(([nome, ts]) => `*${nome}*\n${ts.map((t) => `- ${t}`).join("\n")}`);
  return `📋 Checklist de ${d}/${m}: ${p.feitas} de ${p.total} tarefas feitas.\n\nFicou pendente:\n${blocos.join("\n\n")}\n\nVer no painel: ${p.link}`;
}

// ---------------- pontos e faixas

export type Nivel = "ELITE" | "PLATINA" | "LEGEND";
export type LimitesNivel = { nivelPlatina: number; nivelLegend: number };
export const NOME_NIVEL: Record<Nivel, string> = { ELITE: "BLACK ELITE", PLATINA: "BLACK PLATINA", LEGEND: "BLACK LEGEND" };

/** Faixa pelo total acumulado (negativo continua ELITE). */
export function nivelDoFuncionario(pontos: number, cfg: LimitesNivel): Nivel {
  if (pontos >= cfg.nivelLegend) return "LEGEND";
  if (pontos >= cfg.nivelPlatina) return "PLATINA";
  return "ELITE";
}

/** Quanto falta para a proxima faixa (percentual 0-100 dentro da faixa atual; LEGEND = 100). */
export function progressoNivel(pontos: number, cfg: LimitesNivel) {
  const nivel = nivelDoFuncionario(pontos, cfg);
  if (nivel === "LEGEND") return { nivel, proximo: null, faltam: 0, percentual: 100 };
  const [de, ate, proximo] = nivel === "ELITE" ? [0, cfg.nivelPlatina, "PLATINA" as const] : [cfg.nivelPlatina, cfg.nivelLegend, "LEGEND" as const];
  const feito = Math.max(0, pontos - de);
  return { nivel, proximo, faltam: ate - pontos, percentual: Math.min(100, Math.floor((feito / (ate - de)) * 100)) };
}

export function textoRe(p: { nome: string; titulo: string; pontos: number; motivo?: string | null; link: string }) {
  return `${p.nome.split(" ")[0]}, você tomou uma ré 😬 na tarefa "${p.titulo}" (−${p.pontos} pts).\n`
    + `${p.motivo ? `Motivo: ${p.motivo}\n` : ""}Ela foi marcada como feita, mas não estava feita. Faça a tarefa e marque de novo: ${p.link}`;
}
