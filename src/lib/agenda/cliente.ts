/**
 * Acoes do proprio cliente (bot do WhatsApp e area do cliente no site).
 * Mesmas regras da equipe (expediente, bloqueios, sem sobreposicao) mais as de
 * autoatendimento: antecedencia minima, janela de dias, prazo para cancelar e
 * limite de agendamentos futuros.
 */
import { aoCancelarHorario } from "./antecipado";
import type { OrigemAgendamento } from "@prisma/client";
import { db } from "@/lib/db";
import { auditar } from "@/lib/auditoria";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import { publicar } from "@/lib/eventos";
import { precificar } from "@/lib/assinaturas/agenda";
import { configuracao, servicoDoBarbeiro } from "./carregar";
import { conflitoHorario, criarAgendamento, travarBarbeiro, validarEncaixe } from "./agendamentos";
import { validarCadeira } from "./cadeiras";
import { grupoTemComanda } from "./grupo-comanda";
import { dataLocal } from "./tempo";
import { checarTransicaoNaReserva } from "./transicao";

const MIN = 60_000;
const ATIVOS_FUTUROS = ["MARCADO", "CONFIRMADO"] as const;

export async function proximosDoCliente(clienteId: string) {
  return db.agendamento.findMany({
    where: { clienteId, adicionalDeId: null, status: { in: [...ATIVOS_FUTUROS] }, fim: { gt: new Date() } },
    include: { barbeiro: { select: { id: true, nome: true, cor: true, fotoVersao: true } }, servico: { select: { id: true, nome: true } }, adicionais: { where: { origem: "SITE", status: { not: "CANCELADO" } }, orderBy: { inicio: "asc" }, select: { precoCentavos: true, servico: { select: { id: true, nome: true } } } }, antecipado: { select: { status: true, forma: true, link: true } } },
    orderBy: { inicio: "asc" },
  });
}

export async function historicoDoCliente(clienteId: string, limite = 20) {
  return db.agendamento.findMany({
    where: { clienteId, adicionalDeId: null, OR: [{ fim: { lte: new Date() } }, { status: { in: ["CONCLUIDO", "FALTOU", "CANCELADO"] } }] },
    include: { barbeiro: { select: { nome: true } }, servico: { select: { nome: true } }, adicionais: { select: { precoCentavos: true, servico: { select: { nome: true } } } } },
    orderBy: { inicio: "desc" },
    take: limite,
  });
}

/** O mesmo cliente nao pode estar em duas cadeiras ao mesmo tempo. */
async function checarChoqueDoCliente(clienteId: string, inicio: number, fim: number, ignorarId?: string) {
  const choque = await db.agendamento.findFirst({
    where: {
      clienteId,
      adicionalDeId: null,
      status: { in: [...ATIVOS_FUTUROS] },
      inicio: { lt: new Date(fim) },
      fim: { gt: new Date(inicio) },
      ...(ignorarId ? { id: { not: ignorarId } } : {}),
    },
  });
  if (choque) throw new ErroNegocio("Você já tem um horário marcado nesse mesmo período.", 422, "choque_cliente");
}

function checarJanela(inicio: number, cfg: { antecedenciaMinimaMin: number; janelaAgendamentoDias: number }) {
  const agora = Date.now();
  if (inicio < agora + cfg.antecedenciaMinimaMin * MIN) {
    throw new ErroNegocio(`Precisa ser com pelo menos ${cfg.antecedenciaMinimaMin} min de antecedência.`, 422, "antecedencia");
  }
  if (inicio > agora + cfg.janelaAgendamentoDias * 24 * 60 * MIN) {
    throw new ErroNegocio(`Da para agendar até ${cfg.janelaAgendamentoDias} dias à frente.`, 422, "janela");
  }
}

/** Quem faltou demais nos ultimos dias so marca falando com a equipe. */
export async function checarFaltas(clienteId: string, cfg: { limiteFaltas: number; janelaFaltasDias: number }) {
  if (cfg.limiteFaltas <= 0) return;
  const faltas = await db.agendamento.count({
    where: { clienteId, adicionalDeId: null, status: "FALTOU", inicio: { gt: new Date(Date.now() - cfg.janelaFaltasDias * 24 * 60 * MIN) } },
  });
  if (faltas >= cfg.limiteFaltas) {
    throw new ErroNegocio(
      `Como tivemos ${faltas} faltas nos últimos ${cfg.janelaFaltasDias} dias, esse horário precisa ser marcado com a equipe.`,
      422,
      "limite_faltas",
    );
  }
}

export async function agendarPeloCliente(p: {
  telefone: string;
  nome: string;
  barbeiroId: string;
  servicoId: string;
  servicosAdicionais?: string[];
  premioId?: string;
  precoEsperadoCentavos?: number;
  inicio: Date;
  origem: Extract<OrigemAgendamento, "BOT" | "SITE">;
  semPreferencia?: boolean;
  forcarAvulso?: boolean;
}) {
  const cfg = await configuracao();
  const cliente = await db.cliente.findUnique({ where: { telefone: p.telefone } });
  if (cliente) {
    const futuros = await db.agendamento.count({
      where: { clienteId: cliente.id, adicionalDeId: null, status: { in: [...ATIVOS_FUTUROS] }, fim: { gt: new Date() } },
    });
    if (futuros >= cfg.maxAgendamentosCliente) {
      throw new ErroNegocio(
        `Você já tem ${futuros} horário(s) marcado(s). Para marcar outro, cancele ou aguarde o próximo atendimento.`,
        422,
        "limite_cliente",
      );
    }
    await checarFaltas(cliente.id, cfg);
    const servicos = await Promise.all([p.servicoId, ...(p.servicosAdicionais ?? [])].map((id) => servicoDoBarbeiro(p.barbeiroId, id)));
    if (servicos.every(Boolean)) await checarChoqueDoCliente(cliente.id, p.inicio.getTime(), p.inicio.getTime() + servicos.reduce((s, x) => s + (x?.duracaoMin ?? 0), 0) * MIN);
  }
  // criarAgendamento com ator null aplica antecedencia e janela.
  return criarAgendamento(
    {
      barbeiroId: p.barbeiroId,
      servicoId: p.servicoId,
      servicosAdicionais: p.servicosAdicionais,
      premioId: p.premioId,
      precoEsperadoCentavos: p.precoEsperadoCentavos,
      inicio: p.inicio,
      cliente: cliente ? { id: cliente.id } : { telefone: p.telefone, nome: p.nome },
      origem: p.origem,
      semPreferencia: p.semPreferencia,
      forcarAvulso: p.forcarAvulso,
    },
    null,
  );
}

async function doCliente(clienteId: string, agendamentoId: string) {
  const ag = await db.agendamento.findUnique({ where: { id: agendamentoId } });
  if (!ag || ag.clienteId !== clienteId || ag.adicionalDeId) throw naoEncontrado("Agendamento");
  if (!(ATIVOS_FUTUROS as readonly string[]).includes(ag.status)) {
    throw new ErroNegocio("Esse agendamento não pode mais ser alterado.");
  }
  const cfg = await configuracao();
  if (ag.inicio.getTime() - Date.now() < cfg.prazoCancelamentoMin * MIN) {
    const horas = Math.round((cfg.prazoCancelamentoMin / 60) * 10) / 10;
    throw new ErroNegocio(
      `Alterações pelo bot/site só até ${horas}h antes do horário. Fale com a barbearia.`,
      422,
      "prazo_alteracao",
    );
  }
  return { ag, cfg };
}

export async function cancelarPeloCliente(clienteId: string, agendamentoId: string) {
  const { ag, cfg } = await doCliente(clienteId, agendamentoId);
  await db.$transaction(async (tx) => {
    await checarTransicaoNaReserva(tx);
    await travarBarbeiro(tx, ag.barbeiroId);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cliente:${clienteId}`}))`;
    const atual = await tx.agendamento.findUniqueOrThrow({ where: { id: ag.id } });
    if (atual.status !== ag.status || +atual.inicio !== +ag.inicio || atual.barbeiroId !== ag.barbeiroId) throw conflitoHorario();
    if (await grupoTemComanda(tx, ag.id)) throw new ErroNegocio("Este atendimento já tem comanda. Fale com a barbearia para cancelar.", 409, "comanda_existente");
    await tx.agendamento.update({ where: { id: ag.id }, data: { status: "CANCELADO" } });
    await tx.agendamento.updateMany({ where: { adicionalDeId: ag.id }, data: { status: "CANCELADO" } });
    await auditar(tx, null, "cancelar_pelo_cliente", "agendamento", ag.id);
  });
  void aoCancelarHorario(ag.id);
  publicar({ tipo: "agenda", barbeiroIds: [ag.barbeiroId], datas: [dataLocal(ag.inicio, cfg.fuso)] });
  return ag;
}

/** Remarca mantendo o servico; pode trocar de barbeiro. */
export async function remarcarPeloCliente(clienteId: string, agendamentoId: string, novoInicio: Date, barbeiroId?: string, forcarAvulso = false, precoEsperadoCentavos?: number) {
  const { ag, cfg } = await doCliente(clienteId, agendamentoId);
  const adicionais = await db.agendamento.findMany({ where: { adicionalDeId: ag.id, origem: "SITE", status: { not: "CANCELADO" } }, orderBy: { inicio: "asc" } });
  if (adicionais.length && precoEsperadoCentavos === undefined) throw new ErroNegocio("Consulte o valor antes de remarcar.", 422, "preco_obrigatorio");
  const destino = barbeiroId ?? ag.barbeiroId;
  const ids = [ag.servicoId, ...adicionais.map((a) => a.servicoId)];
  const servicos = await Promise.all(ids.map((id) => servicoDoBarbeiro(destino, id)));
  if (servicos.some((s) => !s)) throw new ErroNegocio("Esse barbeiro não faz todos os serviços.");
  const inicio = novoInicio.getTime();
  checarJanela(inicio, cfg);
  const fim = inicio + servicos.reduce((s, item) => s + (item?.duracaoMin ?? 0), 0) * MIN;
  await checarChoqueDoCliente(clienteId, inicio, fim, ag.id);

  try {
    const novo = await db.$transaction(async (tx) => {
      await checarTransicaoNaReserva(tx);
      // Trava origem e destino sempre na mesma ordem (evita deadlock entre remarcacoes cruzadas).
      for (const id of [...new Set([ag.barbeiroId, destino])].sort()) await travarBarbeiro(tx, id);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cliente:${clienteId}`}))`;
      const atual = await tx.agendamento.findUniqueOrThrow({ where: { id: ag.id } });
      if (atual.status !== ag.status || +atual.inicio !== +ag.inicio || +atual.fim !== +ag.fim || atual.barbeiroId !== ag.barbeiroId) throw conflitoHorario();
      const adicionaisAtuais = await tx.agendamento.findMany({ where: { adicionalDeId: ag.id, origem: "SITE", status: { not: "CANCELADO" } }, orderBy: { inicio: "asc" } });
      if (adicionaisAtuais.length !== adicionais.length || adicionaisAtuais.some((a, i) => a.id !== adicionais[i].id || a.status !== adicionais[i].status || +a.inicio !== +adicionais[i].inicio || a.barbeiroId !== adicionais[i].barbeiroId)) throw conflitoHorario();
      if (adicionais.length && await tx.itemComanda.findFirst({ where: { agendamentoId: { in: [ag.id, ...adicionais.map((a) => a.id)] } } })) throw new ErroNegocio("Este atendimento já tem comanda. Fale com a barbearia para alterar.", 409);
      // Revalida sob trava o mesmo prazo exigido ao reservar; não prolonga o prêmio ao remarcar.
      await tx.$queryRaw`SELECT id FROM premios_ganhos WHERE "agendamentoId" = ${ag.id} AND status = 'RESERVADO' ORDER BY id FOR UPDATE`;
      const premios = await tx.premioGanho.findMany({ where: { agendamentoId: ag.id, status: "RESERVADO" }, select: { expiraEm: true } });
      if (premios.some((p) => p.expiraEm && +p.expiraEm < inicio)) throw new ErroNegocio("O novo horário ultrapassa a validade do prêmio reservado. Escolha uma data dentro da validade.", 422, "premio_validade");
      const choque = await tx.agendamento.findFirst({ where: { clienteId, adicionalDeId: null, id: { not: ag.id }, status: { in: [...ATIVOS_FUTUROS] }, inicio: { lt: new Date(fim) }, fim: { gt: new Date(inicio) } } });
      if (choque) throw new ErroNegocio("Você já tem um horário marcado nesse período.", 409, "choque_cliente");
      await validarEncaixe(tx, destino, { inicio, fim }, {
        fuso: cfg.fuso,
        intervaloEntreClientes: cfg.intervaloEntreClientes,
        ignorarAgendamentoId: ag.id,
      });
      const barbeiro = await tx.barbeiro.findUniqueOrThrow({ where: { id: destino } });
      const cadeiraId = destino === ag.barbeiroId ? ag.cadeiraId : barbeiro.cadeiraId;
      await validarCadeira(tx, cadeiraId, { inicio, fim }, ag.id, cfg.intervaloEntreClientes);
      const ignorar = [ag.id, ...adicionais.map((a) => a.id)];
      const usosExtras: { id: string; inicio: number; servicoId: string; futuro: boolean }[] = [];
      const precos = [];
      let posicao = inicio;
      for (let i = 0; i < ids.length; i++) {
        const item = await servicoDoBarbeiro(destino, ids[i], tx);
        if (!item || item.duracaoMin !== servicos[i]?.duracaoMin) throw conflitoHorario();
        const preco = await precificar({ clienteId, servicoId: ids[i], barbeiroId: destino, inicio: posicao,
          precoBase: item.precoCentavos, fuso: cfg.fuso, forcarAvulso, ignorarAgendamentoIds: ignorar, usosExtras, c: tx });
        precos.push(preco);
        if (preco.assinaturaId) usosExtras.push({ id: `remarcar-${ids[i]}`, inicio: posicao, servicoId: ids[i], futuro: posicao > Date.now() });
        posicao += item.duracaoMin * MIN;
      }
      if (precoEsperadoCentavos !== undefined && precos.reduce((s, p) => s + p.precoCentavos, 0) !== precoEsperadoCentavos) throw new ErroNegocio("O valor mudou. Consulte o horário novamente.", 409, "preco_alterado");
      const n = await tx.agendamento.update({
        where: { id: ag.id },
        data: { cadeiraId, inicio: new Date(inicio), fim: new Date(fim), barbeiroId: destino, precoCentavos: precos[0].precoCentavos, assinaturaId: precos[0].assinaturaId },
      });
      posicao = inicio + servicos[0]!.duracaoMin * MIN;
      for (let i = 0; i < adicionais.length; i++) {
        const fimItem = posicao + servicos[i + 1]!.duracaoMin * MIN;
        await tx.agendamento.update({ where: { id: adicionais[i].id }, data: { barbeiroId: destino, inicio: new Date(posicao), fim: new Date(fimItem), precoCentavos: precos[i + 1].precoCentavos, assinaturaId: precos[i + 1].assinaturaId } });
        posicao = fimItem;
      }
      await auditar(tx, null, "remarcar_pelo_cliente", "agendamento", ag.id, {
        de: ag.inicio.toISOString(),
        para: n.inicio.toISOString(),
        barbeiroId: destino,
      });
      return n;
    });
    publicar({
      tipo: "agenda",
      barbeiroIds: [...new Set([ag.barbeiroId, destino])],
      datas: [...new Set([dataLocal(ag.inicio, cfg.fuso), dataLocal(novo.inicio, cfg.fuso)])],
    });
    return novo;
  } catch (e) {
    if (e instanceof Error && e.message.includes("agendamentos_sem_sobreposicao")) throw conflitoHorario();
    throw e;
  }
}

/** Cliente confirma presenca (resposta ao lembrete). */
export async function confirmarPeloCliente(clienteId: string, agendamentoId: string) {
  const ag = await db.agendamento.findUnique({ where: { id: agendamentoId } });
  if (!ag || ag.clienteId !== clienteId || ag.adicionalDeId) throw naoEncontrado("Agendamento");
  if (ag.status === "CONFIRMADO") return ag;
  if (ag.status !== "MARCADO" || ag.inicio.getTime() < Date.now()) throw new ErroNegocio("Esse horário não pode mais ser confirmado.");
  const cfg = await configuracao();
  const novo = await db.$transaction(async (tx) => {
    await travarBarbeiro(tx, ag.barbeiroId);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cliente:${clienteId}`}))`;
    const atual = await tx.agendamento.findUnique({ where: { id: agendamentoId } });
    if (!atual || atual.clienteId !== clienteId || atual.adicionalDeId) throw naoEncontrado("Agendamento");
    if (atual.barbeiroId !== ag.barbeiroId || +atual.inicio !== +ag.inicio) throw conflitoHorario();
    if (atual.status === "CONFIRMADO") return atual;
    if (atual.status !== "MARCADO" || atual.inicio.getTime() < Date.now()) throw new ErroNegocio("Esse horário não pode mais ser confirmado.");
    const n = await tx.agendamento.update({ where: { id: agendamentoId }, data: { status: "CONFIRMADO" } });
    await tx.agendamento.updateMany({ where: { adicionalDeId: agendamentoId, status: "MARCADO" }, data: { status: "CONFIRMADO" } });
    await auditar(tx, null, "confirmar_cliente", "agendamento", agendamentoId, {});
    return n;
  });
  publicar({ tipo: "agenda", barbeiroIds: [novo.barbeiroId], datas: [dataLocal(novo.inicio, cfg.fuso)] });
  return novo;
}
