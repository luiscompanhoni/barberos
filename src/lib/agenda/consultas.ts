import { db } from "@/lib/db";
import { carregarDia, configuracao, limitesDoDia, servicoDoBarbeiro } from "./carregar";
import { horariosLivres } from "./disponibilidade";
import { somarDias } from "./tempo";

/** Tudo que a tela de agenda precisa para desenhar um dia (ou varios, na semana). */
export async function agendaDoPeriodo(dataInicial: string, dias: number, filtroBarbeiroId?: string) {
  const cfg = await configuracao();
  const barbeiros = await db.barbeiro.findMany({
    where: { ativo: true, ...(filtroBarbeiroId ? { id: filtroBarbeiroId } : {}) },
    orderBy: [{ ordem: "asc" }, { nome: "asc" }],
    select: { id: true, nome: true, cor: true },
  });
  const ids = barbeiros.map((b) => b.id);
  const inicio = limitesDoDia(dataInicial, cfg.fuso).inicio;
  const fim = limitesDoDia(somarDias(dataInicial, dias - 1), cfg.fuso).fim;

  const [agendamentos, porDia] = await Promise.all([
    db.agendamento.findMany({
      where: {
        barbeiroId: { in: ids },
        status: { not: "CANCELADO" },
        inicio: { lt: new Date(fim) },
        fim: { gt: new Date(inicio) },
      },
      include: {
        cliente: { select: { id: true, nome: true, telefone: true, observacoes: true } },
        servico: { select: { id: true, nome: true } },
      },
      orderBy: { inicio: "asc" },
    }),
    Promise.all(
      Array.from({ length: dias }, (_, i) => somarDias(dataInicial, i)).map(async (data) => ({
        data,
        mapa: await carregarDia(data, ids, { fuso: cfg.fuso }),
      })),
    ),
  ]);

  return {
    fuso: cfg.fuso,
    granularidadeMin: cfg.granularidadeMin,
    barbeiros,
    agendamentos: agendamentos.map((a) => ({
      id: a.id,
      barbeiroId: a.barbeiroId,
      inicio: a.inicio.toISOString(),
      fim: a.fim.toISOString(),
      status: a.status,
      origem: a.origem,
      precoCentavos: a.precoCentavos,
      observacao: a.observacao,
      semPreferencia: a.semPreferencia,
      cliente: a.cliente,
      servico: a.servico,
      assinante: a.assinaturaId !== null,
    })),
    dias: porDia.map(({ data, mapa }) => ({
      data,
      barbeiros: [...mapa.values()].map((d) => ({
        barbeiroId: d.barbeiroId,
        janelas: d.janelas.map((j) => ({ inicio: new Date(j.inicio).toISOString(), fim: new Date(j.fim).toISOString() })),
        bloqueios: d.bloqueios.map((b) => ({
          id: b.id,
          motivo: b.motivo,
          inicio: new Date(b.inicio).toISOString(),
          fim: new Date(b.fim).toISOString(),
        })),
      })),
    })),
  };
}

/**
 * Horarios livres para um servico numa data. Base do bot (Fase 2), do site do
 * cliente e do formulario de encaixe. `paraCliente` aplica antecedencia minima.
 */
export async function horariosDisponiveis(p: {
  data: string;
  servicoId: string;
  barbeiroId?: string;
  paraCliente: boolean;
}) {
  const cfg = await configuracao();
  const barbeiros = await db.barbeiro.findMany({
    where: { ativo: true, ...(p.barbeiroId ? { id: p.barbeiroId } : {}), servicos: { some: { servicoId: p.servicoId } } },
    orderBy: [{ ordem: "asc" }, { nome: "asc" }],
    select: { id: true, nome: true },
  });
  const mapa = await carregarDia(p.data, barbeiros.map((b) => b.id), { fuso: cfg.fuso });
  const agora = Date.now();
  const naoAntesDe = p.paraCliente ? agora + cfg.antecedenciaMinimaMin * 60_000 : agora - cfg.granularidadeMin * 60_000;

  const out = [];
  for (const b of barbeiros) {
    const sb = await servicoDoBarbeiro(b.id, p.servicoId);
    if (!sb) continue;
    const dia = mapa.get(b.id)!;
    const inicios = horariosLivres({
      janelas: dia.janelas,
      bloqueios: dia.bloqueios,
      agendamentos: dia.agendamentos,
      duracaoMin: sb.duracaoMin,
      granularidadeMin: cfg.granularidadeMin,
      intervaloEntreClientesMin: cfg.intervaloEntreClientes,
      naoAntesDe,
    });
    out.push({
      barbeiroId: b.id,
      nome: b.nome,
      duracaoMin: sb.duracaoMin,
      precoCentavos: sb.precoCentavos,
      horarios: inicios.map((ms) => new Date(ms).toISOString()),
    });
  }
  return out;
}
