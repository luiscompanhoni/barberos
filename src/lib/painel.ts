/**
 * Numeros do painel do dono: o dia de hoje, o que precisa de acao e o mapa de
 * horarios de pico. Tudo calculado a partir da agenda (sem tabela extra).
 */
import { db } from "@/lib/db";
import { carregarDia, configuracao, limitesDoDia } from "@/lib/agenda/carregar";
import { subtrair, unir, type Intervalo } from "@/lib/agenda/disponibilidade";
import { atendimentosForaDoExpediente } from "@/lib/agenda/expediente";
import { dataLocal, diaSemana, instanteLocal, somarDias } from "@/lib/agenda/tempo";

const MIN = 60_000;
const ATIVOS = ["MARCADO", "CONFIRMADO", "CHEGOU", "EM_ATENDIMENTO", "CONCLUIDO"] as const;

/** Minutos de `a` que caem dentro de `b`. */
function sobreposicaoMin(a: Intervalo, b: Intervalo) {
  return Math.max(0, Math.min(a.fim, b.fim) - Math.max(a.inicio, b.inicio)) / MIN;
}

function somaMin(ints: Intervalo[]) {
  return ints.reduce((t, i) => t + (i.fim - i.inicio) / MIN, 0);
}

export async function resumoDoDia() {
  const cfg = await configuracao();
  const agora = Date.now();
  const hoje = dataLocal(agora, cfg.fuso);
  const barbeiros = await db.barbeiro.findMany({ where: { ativo: true }, select: { id: true, nome: true } });
  const ids = barbeiros.map((b) => b.id);
  const dia = limitesDoDia(hoje, cfg.fuso);
  const mapa = await carregarDia(hoje, ids, { fuso: cfg.fuso });

  const ags = await db.agendamento.findMany({
    where: { barbeiroId: { in: ids }, inicio: { gte: new Date(dia.inicio), lt: new Date(dia.fim) }, status: { not: "CANCELADO" } },
    select: { status: true, precoCentavos: true, inicio: true, fim: true, barbeiroId: true },
  });

  let capacidade = 0;
  let ocupado = 0;
  const porBarbeiro = barbeiros.map((b) => {
    const d = mapa.get(b.id)!;
    const trabalho = subtrair(d.janelas, d.bloqueios);
    const cap = somaMin(trabalho);
    const seus = ags.filter((a) => a.barbeiroId === b.id && a.status !== "FALTOU");
    const oc = seus.reduce((t, a) => t + trabalho.reduce((s, j) => s + sobreposicaoMin({ inicio: +a.inicio, fim: +a.fim }, j), 0), 0);
    capacidade += cap;
    ocupado += oc;
    return { id: b.id, nome: b.nome, atendimentos: seus.length, ocupacao: cap ? oc / cap : null };
  });

  const validos = ags.filter((a) => a.status !== "FALTOU");
  return {
    data: hoje,
    atendimentos: validos.length,
    concluidos: ags.filter((a) => a.status === "CONCLUIDO").length,
    faltas: ags.filter((a) => a.status === "FALTOU").length,
    previstoCentavos: validos.reduce((t, a) => t + a.precoCentavos, 0),
    realizadoCentavos: ags.filter((a) => a.status === "CONCLUIDO").reduce((t, a) => t + a.precoCentavos, 0),
    ocupacao: capacidade ? ocupado / capacidade : null,
    livresMin: Math.max(0, Math.round(capacidade - ocupado)),
    porBarbeiro,
  };
}

/** Comparativo do mes atual com o mesmo periodo do mes passado (atendimentos concluidos). */
export async function resumoDoMes() {
  const cfg = await configuracao();
  const hoje = dataLocal(Date.now(), cfg.fuso);
  const [ano, mes, dia] = hoje.split("-").map(Number);
  const inicioMes = instanteLocal(`${hoje.slice(0, 8)}01`, 0, cfg.fuso);
  const fimHoje = limitesDoDia(hoje, cfg.fuso).fim;
  const mesPassado = new Date(Date.UTC(ano, mes - 2, 1)).toISOString().slice(0, 10);
  const inicioPassado = instanteLocal(mesPassado, 0, cfg.fuso);
  const fimPassado = limitesDoDia(somarDias(mesPassado, dia - 1), cfg.fuso).fim;

  const soma = async (de: number, ate: number) => {
    const r = await db.agendamento.aggregate({
      where: { status: "CONCLUIDO", inicio: { gte: new Date(de), lt: new Date(ate) } },
      _sum: { precoCentavos: true },
      _count: true,
    });
    return { centavos: r._sum.precoCentavos ?? 0, atendimentos: r._count };
  };
  const [atual, anterior, novos, faltas] = await Promise.all([
    soma(inicioMes, fimHoje),
    soma(inicioPassado, fimPassado),
    db.cliente.count({ where: { criadoEm: { gte: new Date(inicioMes) } } }),
    db.agendamento.count({ where: { status: "FALTOU", inicio: { gte: new Date(inicioMes), lt: new Date(fimHoje) } } }),
  ]);
  return { atual, anterior, clientesNovos: novos, faltas };
}

/** Lista "precisa de acao hoje": pendencias que a equipe resolve direto do painel. */
export async function pendencias() {
  const cfg = await configuracao();
  const agora = Date.now();

  const [semBaixa, conversas, barbeiros, concluidos, futuros, faltosos] = await Promise.all([
    // Atendimento que ja terminou e ninguem marcou como concluido ou falta.
    db.agendamento.findMany({
      where: {
        status: { in: ["MARCADO", "CONFIRMADO", "CHEGOU", "EM_ATENDIMENTO"] },
        fim: { lt: new Date(agora - 30 * MIN), gt: new Date(agora - 7 * 24 * 60 * MIN) },
      },
      orderBy: { inicio: "desc" },
      take: 20,
      select: { id: true, inicio: true, cliente: { select: { nome: true } }, barbeiro: { select: { nome: true } }, servico: { select: { nome: true } } },
    }),
    db.conversa.findMany({
      where: { estado: "HUMANO" },
      orderBy: { atualizadoEm: "desc" },
      take: 10,
      select: { id: true, telefone: true, nomePerfil: true, naoLidas: true, atualizadoEm: true, cliente: { select: { nome: true } } },
    }),
    db.barbeiro.findMany({ where: { ativo: true }, select: { id: true, nome: true } }),
    // Ultima visita concluida de cada cliente.
    db.agendamento.groupBy({ by: ["clienteId"], where: { status: "CONCLUIDO" }, _max: { inicio: true } }),
    db.agendamento.findMany({
      where: { status: { in: ["MARCADO", "CONFIRMADO"] }, inicio: { gt: new Date(agora) } },
      select: { clienteId: true },
    }),
    db.agendamento.groupBy({
      by: ["clienteId"],
      where: { status: "FALTOU", inicio: { gt: new Date(agora - 60 * 24 * 60 * MIN) } },
      _count: true,
      having: { clienteId: { _count: { gte: 2 } } },
    }),
  ]);

  const foraDoExpediente = (
    await Promise.all(barbeiros.map(async (b) => (await atendimentosForaDoExpediente(b.id)).map((a) => ({ ...a, barbeiroNome: b.nome }))))
  ).flat();

  // Sumidos: ultima visita ha mais de 35 dias e nada marcado.
  const comFuturo = new Set(futuros.map((f) => f.clienteId));
  const limite = agora - 35 * 24 * 60 * MIN;
  const idsSumidos = concluidos
    .filter((c) => c._max.inicio && c._max.inicio.getTime() < limite && !comFuturo.has(c.clienteId))
    .sort((a, b) => a._max.inicio!.getTime() - b._max.inicio!.getTime())
    .slice(0, 10);
  const clientesSumidos = await db.cliente.findMany({
    where: { id: { in: idsSumidos.map((c) => c.clienteId) } },
    select: { id: true, nome: true, telefone: true },
  });
  const sumidos = idsSumidos
    .map((c) => ({ ...clientesSumidos.find((x) => x.id === c.clienteId)!, ultimaVisita: c._max.inicio!.toISOString() }))
    .filter((c) => c.nome !== undefined);

  const clientesFaltosos = await db.cliente.findMany({
    where: { id: { in: faltosos.map((f) => f.clienteId) } },
    select: { id: true, nome: true, telefone: true },
  });

  return {
    semBaixa,
    conversas,
    foraDoExpediente: foraDoExpediente.map((a) => ({
      id: a.id, inicio: a.inicio, barbeiroNome: a.barbeiroNome, cliente: a.cliente, servico: a.servico,
    })),
    sumidos,
    faltosos: clientesFaltosos.map((c) => ({ ...c, faltas: faltosos.find((f) => f.clienteId === c.id)?._count ?? 0 })),
    fuso: cfg.fuso,
  };
}

/**
 * Mapa de calor: ocupacao media por dia da semana e hora nos ultimos `dias`
 * (minutos atendidos / minutos disponiveis na agenda).
 */
export async function mapaDePico(dias = 28) {
  const cfg = await configuracao();
  const hoje = dataLocal(Date.now(), cfg.fuso);
  const barbeiros = await db.barbeiro.findMany({ where: { ativo: true }, select: { id: true } });
  const ids = barbeiros.map((b) => b.id);
  const inicio = limitesDoDia(somarDias(hoje, -dias), cfg.fuso).inicio;
  const ags = await db.agendamento.findMany({
    where: { barbeiroId: { in: ids }, status: { in: [...ATIVOS] }, inicio: { gte: new Date(inicio), lt: new Date(limitesDoDia(hoje, cfg.fuso).inicio) } },
    select: { barbeiroId: true, inicio: true, fim: true },
  });

  // cap[ds][h] e oc[ds][h] em minutos
  const cap = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const oc = Array.from({ length: 7 }, () => new Array(24).fill(0));
  for (let i = dias; i >= 1; i--) {
    const data = somarDias(hoje, -i);
    const ds = diaSemana(data);
    const mapa = await carregarDia(data, ids, { fuso: cfg.fuso });
    for (const id of ids) {
      const d = mapa.get(id)!;
      const trabalho = subtrair(d.janelas, d.bloqueios);
      const seus = unir(ags.filter((a) => a.barbeiroId === id && dataLocal(a.inicio, cfg.fuso) === data).map((a) => ({ inicio: +a.inicio, fim: +a.fim })));
      for (let h = 0; h < 24; h++) {
        const hora = { inicio: instanteLocal(data, h * 60, cfg.fuso), fim: instanteLocal(data, h * 60 + 60, cfg.fuso) };
        const livreNaHora = trabalho.reduce((t, j) => t + sobreposicaoMin(j, hora), 0);
        if (!livreNaHora) continue;
        cap[ds][h] += livreNaHora;
        const trabNaHora = trabalho.map((j) => ({ inicio: Math.max(j.inicio, hora.inicio), fim: Math.min(j.fim, hora.fim) })).filter((j) => j.fim > j.inicio);
        oc[ds][h] += seus.reduce((t, a) => t + trabNaHora.reduce((s, j) => s + sobreposicaoMin(a, j), 0), 0);
      }
    }
  }
  const horas = [...Array(24).keys()].filter((h) => cap.some((linha) => linha[h] > 0));
  return {
    dias,
    horas,
    // linhas: segunda..domingo
    linhas: [1, 2, 3, 4, 5, 6, 0].map((ds) => ({
      diaSemana: ds,
      valores: horas.map((h) => (cap[ds][h] ? oc[ds][h] / cap[ds][h] : null)),
    })),
  };
}
