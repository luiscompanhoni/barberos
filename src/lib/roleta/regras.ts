/**
 * Regras puras da roleta de premios (sorteio por peso, chances, bonus e giros disponiveis).
 */

export type PremioPeso = { id: string; peso: number; ativo: boolean; limiteMensal: number | null };

/** Premios que podem sair agora: ativos, com peso e sem ter batido o limite do mes. */
export function elegiveis<T extends PremioPeso>(premios: T[], saiuNoMes: Map<string, number>) {
  return premios.filter((p) => p.ativo && p.peso > 0 && (p.limiteMensal === null || (saiuNoMes.get(p.id) ?? 0) < p.limiteMensal));
}

/** Escolhe pelo peso. `r` e um inteiro sorteado em [0, soma dos pesos). */
export function sortear<T extends { peso: number }>(premios: T[], r: number): T {
  const total = premios.reduce((t, p) => t + p.peso, 0);
  if (!premios.length || total <= 0) throw new Error("Nenhum prêmio disponível na roleta.");
  if (r < 0 || r >= total) throw new Error("Sorteio fora da faixa.");
  let acc = 0;
  for (const p of premios) {
    acc += p.peso;
    if (r < acc) return p;
  }
  return premios[premios.length - 1];
}

/** Chance de cada premio em % (2 casas), considerando so os ativos com peso. */
export function chances(premios: { id: string; peso: number; ativo: boolean }[]) {
  const vivos = premios.filter((p) => p.ativo && p.peso > 0);
  const total = vivos.reduce((t, p) => t + p.peso, 0);
  return new Map(premios.map((p) => [p.id, total && p.ativo && p.peso > 0 ? Math.round((p.peso / total) * 10_000) / 100 : 0]));
}

/** Multiplicador x100 (assinante ganha o bonus nos premios em dinheiro). */
export const multiplicador = (assinante: boolean, bonusPct: number) => (assinante ? 100 + Math.max(0, bonusPct) : 100);
export const comBonus = (valorCentavos: number, mult: number) => Math.round((valorCentavos * mult) / 100);

/** Quantos giros o cliente tem agora. */
export function girosDisponiveis(p: {
  atendimentos: number;
  girosPorAtendimento: number;
  usadosPorAtendimento: number;
  giroGratisDias: number;
  ultimoGratis: Date | null;
  agora: number;
}) {
  const porAtendimento = Math.max(0, p.atendimentos * p.girosPorAtendimento - p.usadosPorAtendimento);
  const proximoGratis = p.giroGratisDias > 0 ? (p.ultimoGratis ? p.ultimoGratis.getTime() + p.giroGratisDias * 86_400_000 : 0) : null;
  const gratis = proximoGratis !== null && proximoGratis <= p.agora;
  return { porAtendimento, gratis, total: porAtendimento + (gratis ? 1 : 0), proximoGratisEm: proximoGratis !== null && !gratis ? new Date(proximoGratis) : null };
}
