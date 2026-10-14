/**
 * Capacidade da agenda nos proximos 3, 7 e 14 dias: horarios livres por barbeiro (expediente menos bloqueios e
 * atendimentos marcados, so do "agora + antecedencia minima" em diante) e quantos atendimentos ainda cabem.
 */
import { carregarDia, configuracao } from "@/lib/agenda/carregar";
import { subtrair, unir, type Intervalo } from "@/lib/agenda/disponibilidade";
import { dataLocal, minParaHhmm, minutosLocal, somarDias } from "@/lib/agenda/tempo";
import { db } from "@/lib/db";
import { vagasNasJanelas } from "./regras";

export const HORIZONTES = [3, 7, 14] as const;
const MIN = 60_000;
const soma = (xs: Intervalo[]) => xs.reduce((t, x) => t + (x.fim - x.inicio), 0) / MIN;

/** Servico que mais sai (ultimos 90 dias) define o tamanho da vaga; sem historico, o primeiro servico ativo. */
async function servicoPrincipal(agora: number) {
  const top = await db.agendamento.groupBy({
    by: ["servicoId"], where: { status: "CONCLUIDO", inicio: { gte: new Date(agora - 90 * 86_400_000) } },
    _count: { _all: true }, orderBy: { _count: { servicoId: "desc" } }, take: 1,
  });
  const s = top[0]
    ? await db.servico.findUnique({ where: { id: top[0].servicoId }, select: { id: true, nome: true, duracaoMin: true } })
    : await db.servico.findFirst({ where: { ativo: true }, orderBy: [{ ordem: "asc" }, { nome: "asc" }], select: { id: true, nome: true, duracaoMin: true } });
  return s ?? { id: "", nome: "Atendimento", duracaoMin: 30 };
}

export async function capacidadeDaAgenda(agora = Date.now()) {
  const cfg = await configuracao();
  const hoje = dataLocal(agora, cfg.fuso);
  const barbeiros = await db.barbeiro.findMany({ where: { ativo: true }, orderBy: [{ ordem: "asc" }, { nome: "asc" }], select: { id: true, nome: true } });
  const ids = barbeiros.map((b) => b.id);
  const servico = await servicoPrincipal(agora);
  // Barbeiro com duracao propria para o servico (ex.: um corta em 40 min) usa a dele.
  const proprias = servico.id
    ? new Map((await db.barbeiroServico.findMany({ where: { servicoId: servico.id, barbeiroId: { in: ids } } })).map((x) => [x.barbeiroId, x.duracaoMin]))
    : new Map<string, number | null>();
  const duracao = (id: string) => proprias.get(id) ?? servico.duracaoMin;
  // Daqui a antecedencia minima, arredondado para a grade da agenda (o cliente so marca em 9:00, 9:15...).
  const grade = Math.max(1, cfg.granularidadeMin) * MIN;
  const aPartirDe: Intervalo = { inicio: 0, fim: Math.ceil((agora + cfg.antecedenciaMinimaMin * MIN) / grade) * grade };

  const max = HORIZONTES.at(-1)!;
  type Dia = { data: string; capacidadeMin: number; livresMin: number; vagas: number; janelas: Intervalo[] };
  const porBarbeiro = new Map<string, Dia[]>(ids.map((id) => [id, []]));
  for (let i = 0; i < max; i++) {
    const data = somarDias(hoje, i);
    const mapa = await carregarDia(data, ids, { fuso: cfg.fuso });
    for (const id of ids) {
      const d = mapa.get(id)!;
      const trabalho = subtrair(subtrair(d.janelas, d.bloqueios), [aPartirDe]);
      const livres = subtrair(trabalho, unir(d.agendamentos));
      const janelas = livres.filter((j) => j.fim - j.inicio >= duracao(id) * MIN);
      porBarbeiro.get(id)!.push({
        data, capacidadeMin: soma(trabalho), livresMin: soma(livres),
        vagas: vagasNasJanelas(livres, duracao(id), cfg.intervaloEntreClientes), janelas,
      });
    }
  }

  const resumo = (dias: Dia[]) => {
    const cap = dias.reduce((t, d) => t + d.capacidadeMin, 0), liv = dias.reduce((t, d) => t + d.livresMin, 0);
    return { vagas: dias.reduce((t, d) => t + d.vagas, 0), livresMin: Math.round(liv), capacidadeMin: Math.round(cap), ocupacao: cap ? 1 - liv / cap : null };
  };
  return {
    hoje,
    antecedenciaMin: cfg.antecedenciaMinimaMin,
    servico: { nome: servico.nome, duracaoMin: servico.duracaoMin },
    intervaloMin: cfg.intervaloEntreClientes,
    horizontes: HORIZONTES.map((n) => {
      const linhas = barbeiros.map((b) => ({ id: b.id, nome: b.nome, duracaoMin: duracao(b.id), ...resumo(porBarbeiro.get(b.id)!.slice(0, n)) }));
      const vagas = linhas.reduce((t, l) => t + l.vagas, 0);
      return { dias: n, ...resumo(barbeiros.flatMap((b) => porBarbeiro.get(b.id)!.slice(0, n))), vagas, porBarbeiro: linhas };
    }),
    // Horarios ociosos: cada janela livre onde cabe pelo menos um atendimento (para a tela listar por barbeiro).
    ociosos: barbeiros.map((b) => ({
      id: b.id,
      janelas: porBarbeiro.get(b.id)!.flatMap((d) => d.janelas.map((j) => ({
        data: d.data,
        inicio: minParaHhmm(minutosLocal(j.inicio, cfg.fuso)),
        fim: minParaHhmm(dataLocal(j.fim, cfg.fuso) === d.data ? minutosLocal(j.fim, cfg.fuso) : 24 * 60),
        vagas: vagasNasJanelas([j], duracao(b.id), cfg.intervaloEntreClientes),
      }))),
    })),
  };
}
export type Capacidade = Awaited<ReturnType<typeof capacidadeDaAgenda>>;
