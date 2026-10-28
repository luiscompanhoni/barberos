import { subtrair, type Intervalo } from "./disponibilidade";

const MIN = 60_000;

/** Capacidade real: horários alternativos sobrepostos não viram vagas adicionais. */
export function janelasParaEncaixe(p: {
  janelas: Intervalo[]; bloqueios: Intervalo[]; agendamentos: Intervalo[];
  duracaoMin: number; intervaloMin: number; granularidadeMin: number; agora: number;
}) {
  if (p.duracaoMin <= 0 || p.granularidadeMin <= 0 || p.intervaloMin < 0) return [];
  const intervalo = p.intervaloMin * MIN;
  const passo = p.granularidadeMin * MIN;
  const duracao = p.duracaoMin * MIN;
  const livres = subtrair(p.janelas, [
    ...p.bloqueios,
    ...p.agendamentos.map(a => ({ inicio: a.inicio - intervalo, fim: a.fim + intervalo })),
  ]);
  return livres.flatMap(j => {
    const inicio = Math.ceil(Math.max(j.inicio, p.agora) / passo) * passo;
    // O próximo início também precisa respeitar a granularidade da agenda.
    const distancia = Math.ceil((duracao + intervalo) / passo) * passo;
    const quantidade = inicio + duracao <= j.fim ? 1 + Math.floor((j.fim - inicio - duracao) / distancia) : 0;
    return quantidade ? [{ inicio, fim: j.fim, quantidade }] : [];
  });
}

export function erroDuracao(duracaoMin: number, minimoMin: number) {
  if (!Number.isInteger(duracaoMin) || duracaoMin < minimoMin || duracaoMin > 480) {
    return `A duração precisa ter entre ${minimoMin} e 480 minutos inteiros.`;
  }
  return null;
}
