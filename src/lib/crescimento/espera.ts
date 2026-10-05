/**
 * Lista de espera de horario: o cliente queria um dia sem vaga; quando abrir (cancelamento,
 * remarcacao, agenda liberada), ele recebe as opcoes no WhatsApp e o bot marca.
 */
import type { OrigemAgendamento, PeriodoDia } from "@prisma/client";
import { configuracao } from "@/lib/agenda/carregar";
import { horariosDisponiveis } from "@/lib/agenda/consultas";
import { dataLocal, minParaHhmm, minutosLocal, somarDias } from "@/lib/agenda/tempo";
import { db } from "@/lib/db";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import { noPeriodo, type OpcaoHorario } from "./regras";

const MAX_ESPERAS_POR_CLIENTE = 3;

/** Horarios livres do dia no periodo, ja com minutos locais (para filtrar e sugerir). */
export async function opcoesDoDia(data: string, servicoId: string, barbeiroId: string | null, periodo: PeriodoDia) {
  const cfg = await configuracao();
  const disp = await horariosDisponiveis({ data, servicoId, barbeiroId: barbeiroId ?? undefined, paraCliente: true });
  const out: OpcaoHorario[] = [];
  for (const b of disp) {
    for (const h of b.horarios) {
      const minutos = minutosLocal(Date.parse(h), cfg.fuso);
      if (noPeriodo(minutos, periodo)) out.push({ barbeiroId: b.barbeiroId, nome: b.nome, inicio: h, minutos });
    }
  }
  return out;
}

export const descreverOpcao = (o: OpcaoHorario) => `${minParaHhmm(o.minutos)} com ${o.nome}`;

export async function entrarNaEspera(clienteId: string, e: { data: string; servicoId: string; barbeiroId?: string | null; periodo?: PeriodoDia; origem: OrigemAgendamento }) {
  const cfg = await configuracao();
  const hoje = dataLocal(Date.now(), cfg.fuso);
  if (e.data < hoje) throw new ErroNegocio("Esse dia já passou.");
  if (e.data > somarDias(hoje, cfg.janelaAgendamentoDias)) throw new ErroNegocio(`Dá para entrar na espera de até ${cfg.janelaAgendamentoDias} dias à frente.`);
  const servico = await db.servico.findUnique({ where: { id: e.servicoId } });
  if (!servico || !servico.ativo) throw naoEncontrado("Serviço");
  const periodo = e.periodo ?? "QUALQUER";
  // Se ja tem vaga, nao precisa esperar.
  const agora = await opcoesDoDia(e.data, e.servicoId, e.barbeiroId ?? null, periodo);
  if (agora.length) throw new ErroNegocio("Tem horário livre nesse dia: dá para marcar agora mesmo.", 422, "tem_vaga", { opcoes: agora.slice(0, 5) });

  const dataDb = new Date(`${e.data}T00:00:00Z`);
  const igual = await db.esperaHorario.findFirst({ where: { clienteId, data: dataDb, servicoId: e.servicoId, status: "ATIVA" } });
  if (igual) return igual;
  const ativas = await db.esperaHorario.count({ where: { clienteId, status: "ATIVA" } });
  if (ativas >= MAX_ESPERAS_POR_CLIENTE) throw new ErroNegocio(`Você já está esperando vaga em ${ativas} dias. Cancele uma para entrar em outra.`);
  return db.esperaHorario.create({ data: { clienteId, data: dataDb, servicoId: e.servicoId, barbeiroId: e.barbeiroId ?? null, periodo, origem: e.origem } });
}

export async function sairDaEspera(clienteId: string, esperaId: string) {
  const r = await db.esperaHorario.updateMany({ where: { id: esperaId, clienteId, status: "ATIVA" }, data: { status: "CANCELADA" } });
  if (!r.count) throw naoEncontrado("Espera");
}

export async function esperasDoCliente(clienteId: string) {
  const cfg = await configuracao();
  const hoje = new Date(`${dataLocal(Date.now(), cfg.fuso)}T00:00:00Z`);
  const es = await db.esperaHorario.findMany({ where: { clienteId, status: "ATIVA", data: { gte: hoje } }, orderBy: { data: "asc" } });
  const servicos = await db.servico.findMany({ where: { id: { in: es.map((e) => e.servicoId) } }, select: { id: true, nome: true } });
  const barbeiros = await db.barbeiro.findMany({ where: { id: { in: es.map((e) => e.barbeiroId).filter((x): x is string => !!x) } }, select: { id: true, nome: true } });
  return es.map((e) => ({
    id: e.id,
    data: e.data.toISOString().slice(0, 10),
    periodo: e.periodo,
    servico: servicos.find((s) => s.id === e.servicoId)?.nome ?? "?",
    barbeiro: e.barbeiroId ? (barbeiros.find((b) => b.id === e.barbeiroId)?.nome ?? null) : null,
  }));
}

/** Todas as esperas ativas (para a equipe acompanhar). */
export async function esperasAtivas() {
  const cfg = await configuracao();
  const hoje = new Date(`${dataLocal(Date.now(), cfg.fuso)}T00:00:00Z`);
  return db.esperaHorario.findMany({
    where: { status: "ATIVA", data: { gte: hoje } },
    orderBy: [{ data: "asc" }, { criadoEm: "asc" }],
    take: 30,
    include: { cliente: { select: { nome: true, telefone: true } } },
  });
}
