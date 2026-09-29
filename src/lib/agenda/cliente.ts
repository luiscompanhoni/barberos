/**
 * Acoes do proprio cliente (bot do WhatsApp e area do cliente no site).
 * Mesmas regras da equipe (expediente, bloqueios, sem sobreposicao) mais as de
 * autoatendimento: antecedencia minima, janela de dias, prazo para cancelar e
 * limite de agendamentos futuros.
 */
import type { OrigemAgendamento } from "@prisma/client";
import { db } from "@/lib/db";
import { auditar } from "@/lib/auditoria";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import { publicar } from "@/lib/eventos";
import { configuracao, servicoDoBarbeiro } from "./carregar";
import { conflitoHorario, criarAgendamento, travarBarbeiro, validarEncaixe } from "./agendamentos";
import { dataLocal } from "./tempo";

const MIN = 60_000;
const ATIVOS_FUTUROS = ["MARCADO", "CONFIRMADO"] as const;

export async function proximosDoCliente(clienteId: string) {
  return db.agendamento.findMany({
    where: { clienteId, status: { in: [...ATIVOS_FUTUROS] }, fim: { gt: new Date() } },
    include: { barbeiro: { select: { id: true, nome: true } }, servico: { select: { id: true, nome: true } } },
    orderBy: { inicio: "asc" },
  });
}

export async function historicoDoCliente(clienteId: string, limite = 20) {
  return db.agendamento.findMany({
    where: { clienteId, OR: [{ fim: { lte: new Date() } }, { status: { in: ["CONCLUIDO", "FALTOU", "CANCELADO"] } }] },
    include: { barbeiro: { select: { nome: true } }, servico: { select: { nome: true } } },
    orderBy: { inicio: "desc" },
    take: limite,
  });
}

/** O mesmo cliente nao pode estar em duas cadeiras ao mesmo tempo. */
async function checarChoqueDoCliente(clienteId: string, inicio: number, fim: number, ignorarId?: string) {
  const choque = await db.agendamento.findFirst({
    where: {
      clienteId,
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

export async function agendarPeloCliente(p: {
  telefone: string;
  nome: string;
  barbeiroId: string;
  servicoId: string;
  inicio: Date;
  origem: Extract<OrigemAgendamento, "BOT" | "SITE">;
  semPreferencia?: boolean;
}) {
  const cfg = await configuracao();
  const cliente = await db.cliente.findUnique({ where: { telefone: p.telefone } });
  if (cliente) {
    const futuros = await db.agendamento.count({
      where: { clienteId: cliente.id, status: { in: [...ATIVOS_FUTUROS] }, fim: { gt: new Date() } },
    });
    if (futuros >= cfg.maxAgendamentosCliente) {
      throw new ErroNegocio(
        `Você já tem ${futuros} horário(s) marcado(s). Para marcar outro, cancele ou aguarde o próximo atendimento.`,
        422,
        "limite_cliente",
      );
    }
    const sb = await servicoDoBarbeiro(p.barbeiroId, p.servicoId);
    if (sb) await checarChoqueDoCliente(cliente.id, p.inicio.getTime(), p.inicio.getTime() + sb.duracaoMin * MIN);
  }
  // criarAgendamento com ator null aplica antecedencia e janela.
  return criarAgendamento(
    {
      barbeiroId: p.barbeiroId,
      servicoId: p.servicoId,
      inicio: p.inicio,
      cliente: cliente ? { id: cliente.id } : { telefone: p.telefone, nome: p.nome },
      origem: p.origem,
      semPreferencia: p.semPreferencia,
    },
    null,
  );
}

async function doCliente(clienteId: string, agendamentoId: string) {
  const ag = await db.agendamento.findUnique({ where: { id: agendamentoId } });
  if (!ag || ag.clienteId !== clienteId) throw naoEncontrado("Agendamento");
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
    await tx.agendamento.update({ where: { id: ag.id }, data: { status: "CANCELADO" } });
    await auditar(tx, null, "cancelar_pelo_cliente", "agendamento", ag.id);
  });
  publicar({ tipo: "agenda", barbeiroIds: [ag.barbeiroId], datas: [dataLocal(ag.inicio, cfg.fuso)] });
  return ag;
}

/** Remarca mantendo o servico; pode trocar de barbeiro. */
export async function remarcarPeloCliente(clienteId: string, agendamentoId: string, novoInicio: Date, barbeiroId?: string) {
  const { ag, cfg } = await doCliente(clienteId, agendamentoId);
  const destino = barbeiroId ?? ag.barbeiroId;
  const sb = await servicoDoBarbeiro(destino, ag.servicoId);
  if (!sb) throw new ErroNegocio("Esse barbeiro não faz esse serviço.");
  const inicio = novoInicio.getTime();
  checarJanela(inicio, cfg);
  const fim = inicio + sb.duracaoMin * MIN;
  await checarChoqueDoCliente(clienteId, inicio, fim, ag.id);

  try {
    const novo = await db.$transaction(async (tx) => {
      // Trava origem e destino sempre na mesma ordem (evita deadlock entre remarcacoes cruzadas).
      for (const id of [...new Set([ag.barbeiroId, destino])].sort()) await travarBarbeiro(tx, id);
      await validarEncaixe(tx, destino, { inicio, fim }, {
        fuso: cfg.fuso,
        intervaloEntreClientes: cfg.intervaloEntreClientes,
        ignorarAgendamentoId: ag.id,
      });
      const n = await tx.agendamento.update({
        where: { id: ag.id },
        data: { inicio: new Date(inicio), fim: new Date(fim), barbeiroId: destino, precoCentavos: sb.precoCentavos },
      });
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
