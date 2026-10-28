import { aoCancelarHorario } from "./antecipado";
import { Prisma, type TipoExcecao } from "@prisma/client";
import { db } from "@/lib/db";
import { auditar } from "@/lib/auditoria";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import { publicar } from "@/lib/eventos";
import { exigirPermissao } from "@/lib/auth/permissoes";
import { validarCadeira } from "./cadeiras";
import { exigirGestaoBarbeiro, exigirConfigBarbeiro, type Sessao } from "@/lib/auth/sessao";
import { avisarMudanca } from "@/lib/whatsapp/avisos";
import { carregarDia, configuracao, servicoDoBarbeiro, STATUS_ATIVOS } from "./carregar";
import { contido, sobrepoe, type IntervaloMin } from "./disponibilidade";
import { colunaParaData, dataLocal, dataParaColuna } from "./tempo";
import { conflitoHorario, travarBarbeiro, validarEncaixe } from "./agendamentos";

const DIAS_VERIFICADOS = 60;

/** Intervalos validos e sem sobreposicao dentro de cada dia. */
function validarIntervalos(ints: (IntervaloMin & { diaSemana?: number })[]) {
  for (const i of ints) {
    if (!Number.isInteger(i.inicioMin) || !Number.isInteger(i.fimMin) || i.inicioMin < 0 || i.fimMin > 1440 || i.fimMin <= i.inicioMin) {
      throw new ErroNegocio("Horário de expediente inválido.");
    }
  }
  const porDia = new Map<number, IntervaloMin[]>();
  for (const i of ints) porDia.set(i.diaSemana ?? -1, [...(porDia.get(i.diaSemana ?? -1) ?? []), i]);
  for (const lista of porDia.values()) {
    const ord = [...lista].sort((a, b) => a.inicioMin - b.inicioMin);
    for (let k = 1; k < ord.length; k++) {
      if (ord[k].inicioMin < ord[k - 1].fimMin) throw new ErroNegocio("Há horários sobrepostos no mesmo dia.");
    }
  }
}

export async function obterAgendaBarbeiro(barbeiroId: string, ator: Sessao) {
  exigirConfigBarbeiro(ator, barbeiroId);
  const hoje = dataLocal(Date.now(), (await configuracao()).fuso);
  const barbeiro = await db.barbeiro.findUnique({
    where: { id: barbeiroId },
    include: {
      expediente: { orderBy: [{ diaSemana: "asc" }, { inicioMin: "asc" }] },
      excecoes: { where: { data: { gte: dataParaColuna(hoje) } }, orderBy: { data: "asc" } },
      bloqueios: { where: { fim: { gt: new Date() } }, orderBy: { inicio: "asc" } },
    },
  });
  if (!barbeiro) throw naoEncontrado("Barbeiro");
  return {
    id: barbeiro.id,
    nome: barbeiro.nome,
    expediente: barbeiro.expediente.map(({ diaSemana, inicioMin, fimMin }) => ({ diaSemana, inicioMin, fimMin })),
    excecoes: barbeiro.excecoes.map((e) => ({ ...e, data: colunaParaData(e.data) })),
    bloqueios: barbeiro.bloqueios,
  };
}

/**
 * Atendimentos futuros que ficaram fora do expediente depois de uma mudanca.
 * Nao cancela nada: devolve a lista para o barbeiro/dono decidir.
 */
export async function atendimentosForaDoExpediente(barbeiroId: string) {
  const cfg = await configuracao();
  const futuros = await db.agendamento.findMany({
    where: {
      barbeiroId,
      status: { in: ["MARCADO", "CONFIRMADO"] },
      inicio: { gt: new Date(), lt: new Date(Date.now() + DIAS_VERIFICADOS * 86_400_000) },
    },
    include: { cliente: { select: { nome: true, telefone: true } }, servico: { select: { nome: true } } },
    orderBy: { inicio: "asc" },
  });
  const datas = [...new Set(futuros.map((a) => dataLocal(a.inicio, cfg.fuso)))];
  const dias = new Map<string, Awaited<ReturnType<typeof carregarDia>>>();
  for (const d of datas) dias.set(d, await carregarDia(d, [barbeiroId], { fuso: cfg.fuso }));
  return futuros.filter((a) => {
    const dia = dias.get(dataLocal(a.inicio, cfg.fuso))!.get(barbeiroId)!;
    return !contido({ inicio: a.inicio.getTime(), fim: a.fim.getTime() }, dia.janelas);
  });
}

export async function salvarExpediente(
  barbeiroId: string,
  intervalos: (IntervaloMin & { diaSemana: number })[],
  ator: Sessao,
) {
  exigirConfigBarbeiro(ator, barbeiroId);
  await exigirPermissao(ator, "bloquear_agenda");
  validarIntervalos(intervalos);
  await db.$transaction(async (tx) => {
    await tx.expedientePadrao.deleteMany({ where: { barbeiroId } });
    await tx.expedientePadrao.createMany({ data: intervalos.map((i) => ({ ...i, barbeiroId })) });
    await auditar(tx, ator.usuarioId, "expediente", "barbeiro", barbeiroId, intervalos);
  });
  publicar({ tipo: "agenda", barbeiroIds: [barbeiroId], datas: [] });
  return { afetados: await atendimentosForaDoExpediente(barbeiroId) };
}

export async function salvarExcecao(
  barbeiroId: string,
  e: { data: string; tipo: TipoExcecao; intervalos?: IntervaloMin[]; motivo?: string },
  ator: Sessao,
) {
  exigirConfigBarbeiro(ator, barbeiroId);
  await exigirPermissao(ator, "bloquear_agenda");
  const intervalos = e.tipo === "HORARIO_ESPECIAL" ? (e.intervalos ?? []) : [];
  if (e.tipo === "HORARIO_ESPECIAL") {
    if (!intervalos.length) throw new ErroNegocio("Informe o horário desse dia.");
    validarIntervalos(intervalos);
  }
  const data = dataParaColuna(e.data);
  const valorIntervalos = e.tipo === "HORARIO_ESPECIAL" ? (intervalos as Prisma.InputJsonValue) : Prisma.DbNull;
  await db.$transaction(async (tx) => {
    const reg = await tx.excecaoAgenda.upsert({
      where: { barbeiroId_data: { barbeiroId, data } },
      create: { barbeiroId, data, tipo: e.tipo, intervalos: valorIntervalos, motivo: e.motivo },
      update: { tipo: e.tipo, intervalos: valorIntervalos, motivo: e.motivo },
    });
    await auditar(tx, ator.usuarioId, "excecao", "barbeiro", barbeiroId, { id: reg.id, ...e } as Prisma.InputJsonValue);
  });
  publicar({ tipo: "agenda", barbeiroIds: [barbeiroId], datas: [e.data] });
  return { afetados: await atendimentosForaDoExpediente(barbeiroId) };
}

export async function removerExcecao(barbeiroId: string, data: string, ator: Sessao) {
  exigirConfigBarbeiro(ator, barbeiroId);
  await exigirPermissao(ator, "bloquear_agenda");
  await db.$transaction(async (tx) => {
    await tx.excecaoAgenda.deleteMany({ where: { barbeiroId, data: dataParaColuna(data) } });
    await auditar(tx, ator.usuarioId, "remover_excecao", "barbeiro", barbeiroId, { data });
  });
  publicar({ tipo: "agenda", barbeiroIds: [barbeiroId], datas: [data] });
  return { afetados: await atendimentosForaDoExpediente(barbeiroId) };
}

export type Resolucao =
  | { agendamentoId: string; acao: "cancelar" }
  | { agendamentoId: string; acao: "transferir"; barbeiroDestinoId: string };

/**
 * Fecha a agenda num periodo. Sem `confirmar`, so devolve os clientes afetados e
 * quais barbeiros poderiam assumir cada um. Com `confirmar`, exige uma resolucao
 * (transferir ou cancelar) para cada afetado e aplica tudo numa transacao.
 */
export async function fecharAgenda(
  barbeiroId: string,
  p: { inicio: Date; fim: Date; motivo?: string; confirmar: boolean; resolucoes?: Resolucao[] },
  ator: Sessao,
) {
  exigirGestaoBarbeiro(ator, barbeiroId);
  await exigirPermissao(ator, "bloquear_agenda");
  if (p.fim <= p.inicio) throw new ErroNegocio("O fim precisa ser depois do início.");
  const cfg = await configuracao();

  const afetados = await db.agendamento.findMany({
    where: {
      barbeiroId,
      status: { in: [...STATUS_ATIVOS].filter((s) => s !== "CONCLUIDO") },
      inicio: { lt: p.fim },
      fim: { gt: p.inicio },
    },
    include: { cliente: { select: { nome: true, telefone: true } }, servico: { select: { nome: true } } },
    orderBy: { inicio: "asc" },
  });

  if (!p.confirmar) {
    const outros = await db.barbeiro.findMany({ where: { ativo: true, id: { not: barbeiroId } } });
    const conflitos = [];
    for (const a of afetados) {
      const data = dataLocal(a.inicio, cfg.fuso);
      const dias = await carregarDia(data, outros.map((o) => o.id), { fuso: cfg.fuso });
      const int = { inicio: a.inicio.getTime(), fim: a.fim.getTime() };
      const livres = [];
      for (const o of outros) {
        const d = dias.get(o.id)!;
        const faz = await servicoDoBarbeiro(o.id, a.servicoId);
        if (faz && contido(int, d.janelas) && !d.bloqueios.some((b) => sobrepoe(b, int)) && !d.agendamentos.some((x) => sobrepoe(x, int))) {
          livres.push({ id: o.id, nome: o.nome });
        }
      }
      conflitos.push({ ...a, barbeirosLivres: livres });
    }
    return { criado: false as const, conflitos };
  }

  const res = new Map((p.resolucoes ?? []).map((r) => [r.agendamentoId, r]));
  const semResolucao = afetados.filter((a) => !res.has(a.id));
  if (semResolucao.length) {
    throw new ErroNegocio("Decida o que fazer com cada cliente marcado antes de fechar.", 409, "conflitos_pendentes", {
      ids: semResolucao.map((a) => a.id),
    });
  }

  const tocados = new Set<string>([barbeiroId]);
  try {
    const bloqueio = await db.$transaction(async (tx) => {
      const destinos = (p.resolucoes ?? []).flatMap(r => r.acao === "transferir" ? [r.barbeiroDestinoId] : []);
      for (const b of [...new Set([barbeiroId, ...destinos])].sort()) await travarBarbeiro(tx, b);
      const cadeirasDestino = await tx.barbeiro.findMany({ where: { id: { in: destinos } }, select: { cadeiraId: true } });
      for (const cadeiraId of [...new Set(cadeirasDestino.map(b => b.cadeiraId).filter((id): id is string => !!id))].sort()) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cadeira:${cadeiraId}`}))`;
      }
      const vigentes = await tx.agendamento.findMany({ where: { barbeiroId, status: { in: [...STATUS_ATIVOS].filter(s => s !== "CONCLUIDO") }, inicio: { lt: p.fim }, fim: { gt: p.inicio } } });
      if (vigentes.length !== afetados.length || vigentes.some(a => !afetados.some(b => b.id === a.id && +b.inicio === +a.inicio && +b.fim === +a.fim && b.status === a.status))) throw new ErroNegocio("A agenda mudou. Confira os atendimentos afetados novamente.", 409);
      for (const a of afetados) {
        const r = res.get(a.id)!;
        if (r.acao === "cancelar") {
          await tx.agendamento.update({ where: { id: a.id }, data: { status: "CANCELADO" } });
          await auditar(tx, ator.usuarioId, "cancelar_por_fechamento", "agendamento", a.id);
        } else {
          exigirGestaoBarbeiro(ator, r.barbeiroDestinoId);
          if (!(await servicoDoBarbeiro(r.barbeiroDestinoId, a.servicoId, tx))) {
            throw new ErroNegocio(`O barbeiro escolhido não faz ${a.servico.nome}.`);
          }
          await validarEncaixe(tx, r.barbeiroDestinoId, { inicio: a.inicio.getTime(), fim: a.fim.getTime() }, {
            fuso: cfg.fuso,
            intervaloEntreClientes: cfg.intervaloEntreClientes,
          });
          const destino = await tx.barbeiro.findUniqueOrThrow({ where: { id: r.barbeiroDestinoId } });
          if (!destino.ativo) throw new ErroNegocio("O barbeiro de destino está inativo.");
          await validarCadeira(tx, destino.cadeiraId, { inicio: +a.inicio, fim: +a.fim }, a.id, cfg.intervaloEntreClientes);
          await tx.agendamento.update({ where: { id: a.id }, data: { barbeiroId: r.barbeiroDestinoId, cadeiraId: destino.cadeiraId } });
          await auditar(tx, ator.usuarioId, "transferir_por_fechamento", "agendamento", a.id, { para: r.barbeiroDestinoId });
          tocados.add(r.barbeiroDestinoId);
        }
      }
      const b = await tx.bloqueio.create({
        data: { barbeiroId, inicio: p.inicio, fim: p.fim, motivo: p.motivo, criadoPorId: ator.usuarioId },
      });
      await auditar(tx, ator.usuarioId, "fechar_agenda", "bloqueio", b.id, {
        inicio: p.inicio.toISOString(),
        fim: p.fim.toISOString(),
        motivo: p.motivo ?? null,
      });
      return b;
    });
    publicar({ tipo: "agenda", barbeiroIds: [...tocados], datas: [] });
    for (const a of afetados) {
      const cancelado = res.get(a.id)!.acao === "cancelar";
      void avisarMudanca(a.id, cancelado ? "cancelado" : "transferido");
      if (cancelado) void aoCancelarHorario(a.id);
    }
    return { criado: true as const, bloqueio };
  } catch (e) {
    if (e instanceof Error && e.message.includes("agendamentos_sem_sobreposicao")) throw conflitoHorario();
    throw e;
  }
}

export async function reabrirAgenda(bloqueioId: string, ator: Sessao) {
  const b = await db.bloqueio.findUnique({ where: { id: bloqueioId } });
  if (!b) throw naoEncontrado("Bloqueio");
  exigirGestaoBarbeiro(ator, b.barbeiroId);
  await exigirPermissao(ator, "bloquear_agenda");
  await db.$transaction(async (tx) => {
    await tx.bloqueio.delete({ where: { id: bloqueioId } });
    await auditar(tx, ator.usuarioId, "reabrir_agenda", "bloqueio", bloqueioId);
  });
  publicar({ tipo: "agenda", barbeiroIds: [b.barbeiroId], datas: [] });
}
