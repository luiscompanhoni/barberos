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
import { auditar } from "@/lib/auditoria";
import { travarClienteAgenda } from "@/lib/agenda/cliente-identidade";
import type { AgendaApp } from "@/lib/agenda/transicao";
import { schemaEsperaHorario, servicosDaEspera } from "./espera-schemas";
import { noPeriodo, type OpcaoHorario } from "./regras";

const MAX_ESPERAS_POR_CLIENTE = 3;

/** Horarios livres do dia no periodo, ja com minutos locais (para filtrar e sugerir). */
export async function opcoesDoDia(data: string, servicoId: string, barbeiroId: string | null, periodo: PeriodoDia,
  servicosAdicionais: string[] = [], contexto: { app?: AgendaApp; esperaId?: string } = {}) {
  const cfg = await configuracao();
  const disp = await horariosDisponiveis({ data, servicoId, servicosAdicionais, barbeiroId: barbeiroId ?? undefined, paraCliente: true, ...contexto });
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

export async function entrarNaEspera(clienteId: string, entrada: { data: string; servicoId: string; servicosAdicionais?: string[]; barbeiroId?: string | null; periodo?: PeriodoDia; origem: OrigemAgendamento }, app?: AgendaApp) {
  const e = schemaEsperaHorario.parse({ data: entrada.data, servicoId: entrada.servicoId, servicosAdicionais: entrada.servicosAdicionais,
    barbeiroId: entrada.barbeiroId, periodo: entrada.periodo });
  if (app && app.clienteId !== clienteId) throw new ErroNegocio("Cliente incompatível com a sessão.", 403);
  const cfg = await configuracao();
  const hoje = dataLocal(Date.now(), cfg.fuso);
  if (e.data < hoje) throw new ErroNegocio("Esse dia já passou.");
  if (e.data > somarDias(hoje, cfg.janelaAgendamentoDias)) throw new ErroNegocio(`Dá para entrar na espera de até ${cfg.janelaAgendamentoDias} dias à frente.`);
  const ids = servicosDaEspera(e.servicoId, e.servicosAdicionais);
  const [servicos, profissionais] = await Promise.all([
    db.servico.count({ where: { id: { in: ids }, ativo: true } }),
    db.barbeiro.count({ where: { ativo: true, ...(e.barbeiroId ? { id: e.barbeiroId } : {}), AND: ids.map(servicoId => ({ servicos: { some: { servicoId } } })) } }),
  ]);
  if (servicos !== ids.length) throw naoEncontrado("Serviço");
  if (!profissionais) throw new ErroNegocio("Nenhum profissional ativo realiza todos esses serviços. Ajuste a seleção.");
  const periodo = e.periodo ?? "QUALQUER";
  // Se ja tem vaga, nao precisa esperar.
  const agora = await opcoesDoDia(e.data, ids[0], e.barbeiroId ?? null, periodo, ids.slice(1), { app });
  if (agora.length) throw new ErroNegocio("Tem horário livre nesse dia: dá para marcar agora mesmo.", 422, "tem_vaga", { opcoes: agora.slice(0, 5) });

  const dataDb = new Date(`${e.data}T00:00:00Z`);
  return db.$transaction(async tx => {
    if (app) await travarClienteAgenda(tx, clienteId, app.titular);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`espera:${clienteId}`}))`;
    const cliente = await tx.cliente.findFirst({ where: { id: clienteId, excluidoEm: null }, select: { id: true, telefone: true, aceitaMensagens: true } });
    if (!cliente) throw naoEncontrado("Cliente");
    const conversa = await tx.conversa.findUnique({ where: { telefone: cliente.telefone }, select: { recusaAutomaticas: true } });
    if (!cliente.aceitaMensagens || conversa?.recusaAutomaticas) {
      throw new ErroNegocio("Ative os avisos automáticos em Perfil > Meus dados para pedir este aviso.", 422, "avisos_desativados");
    }
    const iguais = await tx.esperaHorario.findMany({ where: { clienteId, data: dataDb, status: { in: ["ATIVA", "AVISADA"] } } });
    const igual = iguais.find(x => x.barbeiroId === (e.barbeiroId ?? null) && x.periodo === periodo &&
      JSON.stringify(servicosDaEspera(x.servicoId, x.servicosAdicionais)) === JSON.stringify(ids));
    if (igual) return igual;
    const ativas = await tx.esperaHorario.count({ where: { clienteId, status: { in: ["ATIVA", "AVISADA"] }, data: { gte: new Date(`${hoje}T00:00:00Z`) } } });
    if (ativas >= MAX_ESPERAS_POR_CLIENTE) throw new ErroNegocio(`Você já tem ${ativas} pedidos de aviso. Cancele um para entrar em outro.`);
    const espera = await tx.esperaHorario.create({ data: { clienteId, data: dataDb, servicoId: ids[0], servicosAdicionais: ids.slice(1),
      barbeiroId: e.barbeiroId ?? null, periodo, origem: entrada.origem } });
    await auditar(tx, app?.titular.usuarioId ?? null, "criar", "espera_horario", espera.id,
      { clienteId, data: e.data, servicos: ids, barbeiroId: e.barbeiroId ?? null, periodo, origem: entrada.origem });
    return espera;
  });
}

export async function sairDaEspera(clienteId: string, esperaId: string, app?: AgendaApp) {
  if (app && app.clienteId !== clienteId) throw new ErroNegocio("Cliente incompatível com a sessão.", 403);
  await db.$transaction(async tx => {
    if (app) await travarClienteAgenda(tx, clienteId, app.titular);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`espera:${clienteId}`}))`;
    const atual = await tx.esperaHorario.findFirst({ where: { id: esperaId, clienteId } });
    if (!atual) throw naoEncontrado("Espera");
    if (atual.status === "CANCELADA") return;
    const r = await tx.esperaHorario.updateMany({ where: { id: esperaId, clienteId, status: { in: ["ATIVA", "AVISADA"] } }, data: { status: "CANCELADA" } });
    if (!r.count) throw naoEncontrado("Espera");
    await auditar(tx, app?.titular.usuarioId ?? null, "cancelar", "espera_horario", esperaId, { clienteId, statusAnterior: atual.status });
  }, { maxWait: 10_000, timeout: 120_000 });
}

export async function esperasDoCliente(clienteId: string) {
  const cfg = await configuracao();
  const hoje = new Date(`${dataLocal(Date.now(), cfg.fuso)}T00:00:00Z`);
  const es = await db.esperaHorario.findMany({ where: { clienteId, status: { in: ["ATIVA", "AVISADA"] }, data: { gte: hoje } }, orderBy: { data: "asc" } });
  const servicos = await db.servico.findMany({ where: { id: { in: es.flatMap(e => [e.servicoId, ...e.servicosAdicionais]) } }, select: { id: true, nome: true } });
  const barbeiros = await db.barbeiro.findMany({ where: { id: { in: es.map((e) => e.barbeiroId).filter((x): x is string => !!x) } }, select: { id: true, nome: true } });
  return es.map((e) => ({
    id: e.id,
    data: e.data.toISOString().slice(0, 10),
    periodo: e.periodo,
    status: e.status,
    servicoId: e.servicoId,
    servicosAdicionais: e.servicosAdicionais,
    barbeiroId: e.barbeiroId,
    servico: [e.servicoId, ...e.servicosAdicionais].map(id => servicos.find(s => s.id === id)?.nome ?? "?").join(" + "),
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
