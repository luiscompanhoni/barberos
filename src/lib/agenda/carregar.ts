import type { Configuracao, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { janelasDeTrabalho, type ExcecaoDia, type Intervalo, type IntervaloMin } from "./disponibilidade";
import { dataParaColuna, instanteLocal, somarDias } from "./tempo";

type Cliente = typeof db | Prisma.TransactionClient;

/** Status que ocupam a agenda (os demais liberam o horario). */
export const STATUS_ATIVOS = ["MARCADO", "CONFIRMADO", "CHEGOU", "EM_ATENDIMENTO", "CONCLUIDO"] as const;

export async function configuracao(c: Cliente = db): Promise<Configuracao> {
  return (
    (await c.configuracao.findUnique({ where: { id: 1 } })) ??
    (await c.configuracao.create({ data: { id: 1 } }))
  );
}

export function excecaoParaDia(e: { tipo: string; intervalos: Prisma.JsonValue } | null): ExcecaoDia | null {
  if (!e) return null;
  if (e.tipo === "FOLGA") return { tipo: "FOLGA" };
  return { tipo: "HORARIO_ESPECIAL", intervalos: (e.intervalos as IntervaloMin[] | null) ?? [] };
}

/** Limites [00:00, 24:00) de uma data local em UTC. */
export function limitesDoDia(data: string, fuso: string): Intervalo {
  return { inicio: instanteLocal(data, 0, fuso), fim: instanteLocal(somarDias(data, 1), 0, fuso) };
}

export type DiaBarbeiro = {
  barbeiroId: string;
  janelas: Intervalo[];
  bloqueios: (Intervalo & { id: string; motivo: string | null })[];
  agendamentos: (Intervalo & { id: string })[];
};

/**
 * Tudo o que define a agenda de varios barbeiros numa data.
 * `ignorarAgendamentoId` exclui um atendimento (usado ao mover o proprio).
 */
export async function carregarDia(
  data: string,
  barbeiroIds: string[],
  opts: { fuso: string; ignorarAgendamentoId?: string; ignorarAgendamentoIds?: string[]; c?: Cliente },
): Promise<Map<string, DiaBarbeiro>> {
  const c = opts.c ?? db;
  const dia = limitesDoDia(data, opts.fuso);
  const titulares = await c.barbeiro.findMany({ where: { id: { in: barbeiroIds } }, select: { id: true, usuarioId: true } });
  const [expediente, excecoes, bloqueios, agendamentos, entrevistas] = await Promise.all([
    c.expedientePadrao.findMany({ where: { barbeiroId: { in: barbeiroIds } } }),
    c.excecaoAgenda.findMany({ where: { barbeiroId: { in: barbeiroIds }, data: dataParaColuna(data) } }),
    c.bloqueio.findMany({
      where: { barbeiroId: { in: barbeiroIds }, inicio: { lt: new Date(dia.fim) }, fim: { gt: new Date(dia.inicio) } },
    }),
    c.agendamento.findMany({
      where: {
        barbeiroId: { in: barbeiroIds },
        status: { in: [...STATUS_ATIVOS] },
        // Filhos antigos/SITE já estão cobertos pelo pai; novos adicionais têm reserva própria.
        OR: [{ adicionalDeId: null }, { ocupaAgenda: true }],
        inicio: { lt: new Date(dia.fim) },
        fim: { gt: new Date(dia.inicio) },
        ...((opts.ignorarAgendamentoId || opts.ignorarAgendamentoIds?.length) ? { id: { notIn: [...(opts.ignorarAgendamentoIds ?? []), ...(opts.ignorarAgendamentoId ? [opts.ignorarAgendamentoId] : [])] } } : {}),
      },
      select: { id: true, barbeiroId: true, inicio: true, fim: true },
    }),
    c.entrevistaRecrutamento.findMany({ where: { estado: "CONFIRMADA", donoId: { in: titulares.flatMap(b => b.usuarioId ? [b.usuarioId] : []) }, inicio: { lt: new Date(dia.fim) }, fim: { gt: new Date(dia.inicio) } }, select: { id: true, donoId: true, inicio: true, fim: true } }),
  ]);

  const out = new Map<string, DiaBarbeiro>();
  for (const id of barbeiroIds) {
    const exc = excecoes.find((e) => e.barbeiroId === id) ?? null;
    out.set(id, {
      barbeiroId: id,
      janelas: janelasDeTrabalho(
        data,
        expediente.filter((e) => e.barbeiroId === id),
        excecaoParaDia(exc),
        opts.fuso,
      ),
      bloqueios: [...bloqueios
        .filter((b) => b.barbeiroId === id)
        .map((b) => ({ id: b.id, motivo: b.motivo, inicio: b.inicio.getTime(), fim: b.fim.getTime() })),
        ...entrevistas.filter(e => titulares.some(b => b.id === id && b.usuarioId === e.donoId) && e.inicio && e.fim).map(e => ({ id: `entrevista:${e.id}`, motivo: "Indisponível", inicio: +e.inicio!, fim: +e.fim! }))],
      agendamentos: agendamentos
        .filter((a) => a.barbeiroId === id)
        .map((a) => ({ id: a.id, inicio: a.inicio.getTime(), fim: a.fim.getTime() })),
    });
  }
  return out;
}

/** Duracao e preco do servico para um barbeiro (null se ele nao faz o servico). */
export async function servicoDoBarbeiro(barbeiroId: string, servicoId: string, c: Cliente = db) {
  const bs = await c.barbeiroServico.findUnique({
    where: { barbeiroId_servicoId: { barbeiroId, servicoId } },
    include: { servico: true },
  });
  if (!bs || !bs.servico.ativo) return null;
  return {
    servico: bs.servico,
    duracaoMin: bs.duracaoMin ?? bs.servico.duracaoMin,
    minimoDuracaoMin: bs.minimoDuracaoMin ?? bs.servico.minimoDuracaoMin,
    precoCentavos: bs.precoCentavos ?? bs.servico.precoCentavos,
  };
}
