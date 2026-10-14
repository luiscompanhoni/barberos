/**
 * Premios ganhos nos jogos: o caminho ate o uso.
 * Ganhou (DISPONIVEL) -> agendou para usar (RESERVADO) -> veio e a recepcao validou (UTILIZADO).
 * Horario cancelado devolve o premio; vencido vira EXPIRADO; so a gerencia cancela (com motivo).
 * O premio nunca some: so muda de situacao, e cada mudanca fica na auditoria.
 */
import type { Prisma } from "@prisma/client";
import { auditar } from "@/lib/auditoria";
import type { Sessao } from "@/lib/auth/sessao";
import { resumoComanda } from "@/lib/comandas/regras";
import { avisarComanda } from "@/lib/comandas/servico";
import { db } from "@/lib/db";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import { premioParaCliente } from "./motor";
import { descontoDoPremio, normalizarCodigo } from "./regras";

type Tx = Prisma.TransactionClient;
const DIA = 86_400_000;
const ABERTOS = ["DISPONIVEL", "RESERVADO"] as const;

/**
 * Arruma as situacoes que dependem do tempo ou da agenda:
 * - reserva de horario cancelado/faltou (ou atendido ha mais de 2 dias sem validar) volta a disponivel;
 * - disponivel vencido expira (reservado espera o horario: a validade conta ate o dia marcado).
 */
export async function atualizarPremios(filtro: { clienteId?: string } = {}) {
  const agora = new Date();
  const soltar = await db.premioGanho.findMany({
    where: {
      ...filtro, status: "RESERVADO",
      OR: [
        { agendamentoId: null },
        { agendamento: { status: { in: ["CANCELADO", "FALTOU"] } } },
        { agendamento: { inicio: { lt: new Date(+agora - 2 * DIA) } } },
      ],
    },
    select: { id: true },
  });
  if (soltar.length) {
    await db.premioGanho.updateMany({ where: { id: { in: soltar.map((p) => p.id) }, status: "RESERVADO" }, data: { status: "DISPONIVEL", agendamentoId: null, reservadoEm: null } });
  }
  await db.premioGanho.updateMany({ where: { ...filtro, status: "DISPONIVEL", expiraEm: { lt: agora } }, data: { status: "EXPIRADO" } });
}

/** "Meus premios": abertos primeiro, depois o historico. */
export async function premiosDoCliente(clienteId: string) {
  await atualizarPremios({ clienteId });
  const ps = await db.premioGanho.findMany({ where: { clienteId }, orderBy: { criadoEm: "desc" }, take: 100, include: { agendamento: { select: { id: true, inicio: true } } } });
  const ordem = (s: string) => (s === "RESERVADO" ? 0 : s === "DISPONIVEL" ? 1 : 2);
  return ps.sort((a, b) => ordem(a.status) - ordem(b.status)).map(premioParaCliente);
}

/** Premios que o cliente pode reservar num agendamento (nao vale para credito: ja esta no saldo). */
export async function premiosParaReservar(clienteId: string) {
  await atualizarPremios({ clienteId });
  const ps = await db.premioGanho.findMany({ where: { clienteId, status: "DISPONIVEL", tipo: { not: "CREDITO" } }, orderBy: { expiraEm: "asc" }, include: { agendamento: true } });
  return ps.map(premioParaCliente);
}

/** Liga o premio ao horario marcado (chamado ao agendar com "usar meu premio"). */
export async function reservarPremio(tx: Tx, clienteId: string, premioId: string, agendamento: { id: string; inicio: Date }) {
  const p = await tx.premioGanho.findUnique({ where: { id: premioId } });
  if (!p || p.clienteId !== clienteId) throw naoEncontrado("Prêmio");
  if (p.status !== "DISPONIVEL") throw new ErroNegocio("Esse prêmio não está disponível para reservar.", 409, "premio_indisponivel");
  if (p.expiraEm && p.expiraEm < agendamento.inicio) {
    throw new ErroNegocio(`Esse prêmio vale até ${p.expiraEm.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}: escolha um horário até lá.`, 422, "premio_validade");
  }
  await tx.premioGanho.update({ where: { id: premioId }, data: { status: "RESERVADO", agendamentoId: agendamento.id, reservadoEm: new Date() } });
  await auditar(tx, null, "premio_reservar", "cliente", clienteId, { premioId, codigo: p.codigo, agendamentoId: agendamento.id });
}

// ---------------- recepcao

const INCLUIR_BALCAO = { cliente: { select: { id: true, nome: true, telefone: true } }, agendamento: { select: { id: true, inicio: true, status: true } } } as const;
type PremioBalcao = Prisma.PremioGanhoGetPayload<{ include: typeof INCLUIR_BALCAO }>;

const paraBalcao = (p: PremioBalcao) => ({
  id: p.id, codigo: p.codigo, jogoId: p.jogoId, rotulo: p.rotulo, tipo: p.tipo, raridade: p.raridade, icone: p.icone,
  valorCentavos: p.valorCentavos, percentual: p.percentual, status: p.status, expiraEm: p.expiraEm, criadoEm: p.criadoEm,
  utilizadoEm: p.utilizadoEm, comandaId: p.comandaId, descontoAplicadoCentavos: p.descontoAplicadoCentavos,
  cliente: p.cliente, agendamento: p.agendamento,
});

/** Busca para a recepcao: pelo codigo do premio ou pelos premios abertos de um cliente. */
export async function buscarPremios(q: { codigo?: string; clienteId?: string; comandaId?: string }) {
  await atualizarPremios(q.clienteId ? { clienteId: q.clienteId } : {});
  if (q.codigo) {
    const codigo = normalizarCodigo(q.codigo);
    if (!codigo) throw new ErroNegocio("Código no formato BB-XXXXXX.", 422, "codigo");
    const p = await db.premioGanho.findUnique({ where: { codigo }, include: INCLUIR_BALCAO });
    return p ? [paraBalcao(p)] : [];
  }
  const where: Prisma.PremioGanhoWhereInput = q.comandaId
    ? { OR: [{ comandaId: q.comandaId }, ...(q.clienteId ? [{ clienteId: q.clienteId, status: { in: [...ABERTOS] }, tipo: { not: "CREDITO" as const } }] : [])] }
    : q.clienteId
      ? { clienteId: q.clienteId, status: { in: [...ABERTOS] }, tipo: { not: "CREDITO" } }
      : { status: { in: [...ABERTOS] }, tipo: { not: "CREDITO" } };
  const ps = await db.premioGanho.findMany({ where, orderBy: [{ status: "desc" }, { expiraEm: "asc" }], take: 200, include: INCLUIR_BALCAO });
  return ps.map(paraBalcao);
}

/**
 * A recepcao valida o premio (cliente veio). Brinde: entregue. Servico gratis / desconto: vira desconto na comanda
 * aberta do cliente (precisa da comanda). Credito ja esta no saldo e nao passa por aqui.
 */
export async function validarPremio(s: Sessao, premioId: string, d: { comandaId?: string | null; codigo?: string | null }) {
  const r = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM premios_ganhos WHERE id = ${premioId} FOR UPDATE`;
    const p = await tx.premioGanho.findUnique({ where: { id: premioId } });
    if (!p) throw naoEncontrado("Prêmio");
    if (d.codigo && normalizarCodigo(d.codigo) !== p.codigo) throw new ErroNegocio("O código não confere com esse prêmio.", 422, "codigo");
    if (p.tipo === "CREDITO") throw new ErroNegocio("Prêmio em dinheiro já está no saldo do cliente: use o saldo na comanda.", 409, "credito");
    if (p.status === "UTILIZADO") throw new ErroNegocio("Esse prêmio já foi utilizado.", 409, "utilizado");
    if (p.status === "CANCELADO") throw new ErroNegocio("Esse prêmio foi cancelado.", 409, "cancelado");
    // Reservado vale ate o dia do horario; disponivel, ate a validade.
    if (p.status === "EXPIRADO" || (p.status === "DISPONIVEL" && p.expiraEm && p.expiraEm < new Date())) {
      throw new ErroNegocio("Esse prêmio venceu.", 409, "expirado");
    }

    let desconto = 0;
    let comandaId: string | null = d.comandaId ?? null;
    if (p.tipo === "SERVICO" || p.tipo === "DESCONTO") {
      if (!comandaId) throw new ErroNegocio("Abra a comanda do cliente e valide o prêmio por ela (o desconto entra na comanda).", 422, "precisa_comanda");
      await tx.$queryRaw`SELECT 1 FROM comandas WHERE id = ${comandaId} FOR UPDATE`;
      const c = await tx.comanda.findUnique({ where: { id: comandaId }, include: { itens: { include: { agendamento: { select: { servicoId: true } } } }, pagamentos: true } });
      if (!c) throw naoEncontrado("Comanda");
      if (c.status !== "ABERTA") throw new ErroNegocio("Essa comanda já foi fechada.");
      if (c.clienteId !== p.clienteId) throw new ErroNegocio("Esse prêmio é de outro cliente.", 403, "outro_cliente");
      const { subtotal } = resumoComanda(c.itens, c.pagamentos, 0);
      const item = p.servicoId ? c.itens.find((i) => i.agendamento?.servicoId === p.servicoId) : null;
      if (p.tipo === "SERVICO" && !item) throw new ErroNegocio("Lance o serviço do prêmio na comanda antes de validar.", 422, "sem_servico");
      desconto = descontoDoPremio(p, { podeDescontar: subtotal - c.descontoCentavos, precoServico: item ? item.precoUnitCentavos * item.quantidade : null });
      if (desconto <= 0) throw new ErroNegocio("A comanda não tem valor para descontar.", 422, "sem_valor");
      await tx.comanda.update({ where: { id: comandaId }, data: { descontoCentavos: c.descontoCentavos + desconto } });
    } else if (comandaId) {
      const c = await tx.comanda.findUnique({ where: { id: comandaId }, select: { clienteId: true } });
      if (!c || c.clienteId !== p.clienteId) comandaId = null;
    }
    await tx.premioGanho.update({
      where: { id: premioId },
      data: {
        // Servico/desconto custa o que descontou (o relatorio soma descontoAplicadoCentavos).
        status: "UTILIZADO", utilizadoEm: new Date(), validadoPorId: s.usuarioId, comandaId, descontoAplicadoCentavos: desconto,
      },
    });
    await auditar(tx, s.usuarioId, "premio_validar", "cliente", p.clienteId, { premioId, codigo: p.codigo, rotulo: p.rotulo, comandaId, descontoCentavos: desconto });
    return { comandaId, descontoCentavos: desconto };
  });
  if (r.comandaId) avisarComanda(r.comandaId);
  return r;
}

/** Desfaz a validacao enquanto a comanda esta aberta (validou no cliente errado, desistiu do servico...). */
export async function desfazerValidacao(s: Sessao, premioId: string) {
  const r = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM premios_ganhos WHERE id = ${premioId} FOR UPDATE`;
    const p = await tx.premioGanho.findUnique({ where: { id: premioId } });
    if (!p) throw naoEncontrado("Prêmio");
    if (p.status !== "UTILIZADO" || p.tipo === "CREDITO") throw new ErroNegocio("Esse prêmio não está validado.", 409);
    if (p.comandaId) {
      const c = await tx.comanda.findUnique({ where: { id: p.comandaId } });
      if (c && c.status !== "ABERTA") throw new ErroNegocio("A comanda já foi fechada: não dá para desfazer.", 409);
      if (c && p.descontoAplicadoCentavos > 0) {
        await tx.comanda.update({ where: { id: c.id }, data: { descontoCentavos: Math.max(0, c.descontoCentavos - p.descontoAplicadoCentavos) } });
      }
    } else if (p.utilizadoEm && Date.now() - +p.utilizadoEm > DIA) {
      throw new ErroNegocio("Só dá para desfazer no mesmo dia.", 409);
    }
    await tx.premioGanho.update({
      where: { id: premioId },
      data: { status: p.agendamentoId ? "RESERVADO" : "DISPONIVEL", utilizadoEm: null, validadoPorId: null, comandaId: null, descontoAplicadoCentavos: 0 },
    });
    await auditar(tx, s.usuarioId, "premio_desfazer", "cliente", p.clienteId, { premioId, codigo: p.codigo, comandaId: p.comandaId });
    return p.comandaId;
  });
  if (r) avisarComanda(r);
}

/** So a gerencia cancela um premio, sempre com motivo (credito ainda nao usado sai do saldo). */
export async function cancelarPremio(s: Sessao, premioId: string, motivo: string) {
  if (motivo.trim().length < 3) throw new ErroNegocio("Escreva o motivo do cancelamento.");
  await db.$transaction(async (tx) => {
    const p = await tx.premioGanho.findUnique({ where: { id: premioId } });
    if (!p) throw naoEncontrado("Prêmio");
    if (p.status === "CANCELADO") return;
    if (p.tipo === "CREDITO") {
      if (!p.beneficioId) throw new ErroNegocio("Crédito sem registro no saldo.", 409);
      const b = await tx.beneficio.findUnique({ where: { id: p.beneficioId } });
      if (!b || b.status !== "DISPONIVEL") throw new ErroNegocio("O cliente já usou esse crédito: não dá para cancelar.", 409);
      await tx.beneficio.update({ where: { id: b.id }, data: { status: "CANCELADO" } });
    } else if (p.status === "UTILIZADO") {
      throw new ErroNegocio("Prêmio já utilizado: desfaça a validação antes.", 409);
    }
    await tx.premioGanho.update({ where: { id: premioId }, data: { status: "CANCELADO", canceladoEm: new Date(), canceladoPorId: s.usuarioId, motivoCancelamento: motivo.trim(), agendamentoId: null } });
    await auditar(tx, s.usuarioId, "premio_cancelar", "cliente", p.clienteId, { premioId, codigo: p.codigo, rotulo: p.rotulo, motivo: motivo.trim() });
  });
}
