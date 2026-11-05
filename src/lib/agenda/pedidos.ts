import { db } from "@/lib/db";
import { auditar } from "@/lib/auditoria";
import { BALCAO, type Sessao } from "@/lib/auth/sessao";
import { ErroNegocio, naoEncontrado, proibido } from "@/lib/erros";
import { publicar } from "@/lib/eventos";
import { configuracao } from "./carregar";
import { criarAgendamento } from "./agendamentos";
import { mesmoPedido, validarPreferencia, type EntradaPedido } from "./pedidos-regras";
import { travarClienteAgenda } from "./cliente-identidade";

export async function criarPedido(clienteId: string, usuarioId: string, p: EntradaPedido, sessaoVersao = 0) {
  const pedido = await db.$transaction(async tx => {
    await travarClienteAgenda(tx, clienteId, { usuarioId, sessaoVersao });
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pedidos-cliente:${clienteId}`}))`;
    const anterior = await tx.pedidoAgendamento.findUnique({ where: { clienteId_chave: { clienteId, chave: p.chave } } });
    if (anterior) {
      if (!mesmoPedido(anterior, p)) throw new ErroNegocio("Este pedido já foi enviado com outros dados. Atualize a página.", 409, "pedido_repetido");
      return anterior;
    }
    const cfg = await configuracao(tx);
    if (!cfg.agendaExternaAtiva) throw new ErroNegocio("O agendamento direto está disponível. Atualize a página para escolher um horário.", 409, "agenda_direta");
    validarPreferencia(p, cfg);
    if (await tx.pedidoAgendamento.count({ where: { clienteId, status: "PENDENTE" } }) >= 3) throw new ErroNegocio("Você já tem três pedidos aguardando conferência. Aguarde ou cancele um deles.", 409, "limite_pedidos");
    const servicos = await tx.servico.count({ where: { id: { in: p.servicoIds }, ativo: true } });
    const profissional = await tx.barbeiro.findFirst({ where: { ativo: true, ...(p.barbeiroId ? { id: p.barbeiroId } : {}), AND: p.servicoIds.map(servicoId => ({ servicos: { some: { servicoId } } })) }, select: { id: true } });
    if (servicos !== p.servicoIds.length || !profissional) throw new ErroNegocio("Os serviços ou profissionais disponíveis mudaram. Atualize a seleção.", 409, "catalogo_alterado");
    const novo = await tx.pedidoAgendamento.create({ data: { clienteId, ...p, observacao: p.observacao || null } });
    await auditar(tx, usuarioId, "solicitar_agendamento", "pedido_agendamento", novo.id, { servicoIds: p.servicoIds, barbeiroId: p.barbeiroId, dataPreferida: p.dataPreferida, horaPreferida: p.horaPreferida });
    return novo;
  });
  publicar({ tipo: "agenda", barbeiroIds: [], datas: [] });
  return { id: pedido.id, status: pedido.status };
}

export async function listarPedidos(clienteId?: string) {
  const pedidos = await db.pedidoAgendamento.findMany({
    where: clienteId ? { clienteId } : { status: "PENDENTE" }, orderBy: { criadoEm: clienteId ? "desc" : "asc" }, take: clienteId ? 20 : 100,
    include: { cliente: { select: { id: true, nome: true, telefone: true } }, barbeiro: { select: { id: true, nome: true } } },
  });
  const ids = [...new Set(pedidos.flatMap(p => p.servicoIds as string[]))];
  const agIds = pedidos.flatMap(p => Array.isArray(p.agendamentoIds) ? p.agendamentoIds as string[] : []);
  const [servicos, agendamentos, profissionais] = await Promise.all([
    db.servico.findMany({ where: { id: { in: ids } }, select: { id: true, nome: true, precoCentavos: true, duracaoMin: true } }),
    db.agendamento.findMany({ where: { id: { in: agIds }, ...(clienteId ? { clienteId } : {}) }, select: { id: true, inicio: true, status: true, barbeiro: { select: { nome: true } } } }),
    clienteId ? [] : db.barbeiro.findMany({ where: { ativo: true }, orderBy: [{ ordem: "asc" }, { nome: "asc" }], select: { id: true, nome: true, servicos: { select: { servicoId: true } } } }),
  ]);
  return {
    profissionais,
    pedidos: pedidos.map(p => ({
      id: p.id, status: p.status, dataPreferida: p.dataPreferida, horaPreferida: p.horaPreferida, observacao: p.observacao,
      criadoEm: p.criadoEm, barbeiro: p.barbeiro,
      ...(!clienteId ? { cliente: p.cliente } : {}),
      servicos: (p.servicoIds as string[]).map(id => servicos.find(s => s.id === id)).filter(Boolean),
      agendamento: agendamentos.find(a => Array.isArray(p.agendamentoIds) && p.agendamentoIds[0] === a.id) ?? null,
    })),
  };
}

export async function cancelarPedido(id: string, clienteId: string, usuarioId: string, sessaoVersao = 0) {
  return db.$transaction(async tx => {
    await travarClienteAgenda(tx, clienteId, { usuarioId, sessaoVersao });
    await tx.$queryRaw`SELECT id FROM pedidos_agendamento WHERE id = ${id} FOR UPDATE`;
    const p = await tx.pedidoAgendamento.findFirst({ where: { id, clienteId } });
    if (!p) throw naoEncontrado("Pedido");
    if (p.status === "CANCELADO") return { id, status: p.status };
    if (p.status !== "PENDENTE") throw new ErroNegocio("A equipe já respondeu a este pedido. Confira seus horários.", 409, "pedido_decidido");
    await tx.pedidoAgendamento.update({ where: { id }, data: { status: "CANCELADO", decididoEm: new Date(), decididoPorId: usuarioId } });
    await auditar(tx, usuarioId, "cancelar_pedido_agendamento", "pedido_agendamento", id, {});
    return { id, status: "CANCELADO" };
  });
}

export async function decidirPedido(id: string, ator: Sessao, decisao: { acao: "recusar" } | { acao: "aprovar"; barbeiroId: string; inicio: Date; conferido: true; precoEsperadoCentavos: number; duracaoEsperadaMin: number; forcarAvulso?: boolean }) {
  if (!BALCAO.includes(ator.papel)) throw proibido();
  if (decisao.acao === "recusar") return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM pedidos_agendamento WHERE id = ${id} FOR UPDATE`;
    const p = await tx.pedidoAgendamento.findUnique({ where: { id } });
    if (!p) throw naoEncontrado("Pedido");
    if (p.status === "RECUSADO") return { id, status: p.status };
    if (p.status !== "PENDENTE") throw new ErroNegocio("Este pedido já foi decidido.", 409, "pedido_decidido");
    await tx.pedidoAgendamento.update({ where: { id }, data: { status: "RECUSADO", decididoPorId: ator.usuarioId, decididoEm: new Date() } });
    await auditar(tx, ator.usuarioId, "recusar_pedido_agendamento", "pedido_agendamento", id, {});
    return { id, status: "RECUSADO" };
  });
  const p = await db.pedidoAgendamento.findUnique({ where: { id } });
  if (!p) throw naoEncontrado("Pedido");
  if (decisao.conferido !== true) throw new ErroNegocio("Confira a agenda principal antes de aprovar.", 422);
  if (!Number.isInteger(decisao.precoEsperadoCentavos) || decisao.precoEsperadoCentavos < 0 || !Number.isInteger(decisao.duracaoEsperadaMin) || decisao.duracaoEsperadaMin < 5) throw new ErroNegocio("Consulte a prévia atual de valor e duração antes de aprovar.", 422, "previa_obrigatoria");
  const ids = p.servicoIds as string[];
  if (p.status === "APROVADO" && Array.isArray(p.agendamentoIds) && typeof p.agendamentoIds[0] === "string") {
    const ag = await db.agendamento.findUnique({ where: { id: p.agendamentoIds[0] } });
    if (!ag || ag.barbeiroId !== decisao.barbeiroId || +ag.inicio !== +decisao.inicio) throw new ErroNegocio("Este pedido já foi aprovado com outro horário. Atualize a conferência.", 409, "pedido_decidido");
    return { id, status: p.status, agendamentoId: ag.id };
  }
  if (p.status !== "PENDENTE") throw new ErroNegocio("Este pedido já foi decidido.", 409, "pedido_decidido");
  if (decisao.inicio.getTime() <= Date.now()) throw new ErroNegocio("Escolha um horário futuro para confirmar.");
  const ag = await criarAgendamento({ pedidoId: id, cliente: { id: p.clienteId }, barbeiroId: decisao.barbeiroId, servicoId: ids[0], servicosAdicionais: ids.slice(1), inicio: decisao.inicio, origem: "SITE", semPreferencia: !p.barbeiroId, observacao: p.observacao ?? undefined,
    precoEsperadoCentavos: decisao.precoEsperadoCentavos, duracaoEsperadaMin: decisao.duracaoEsperadaMin, forcarAvulso: decisao.forcarAvulso === true }, ator);
  return { id, status: "APROVADO", agendamentoId: ag.id };
}

