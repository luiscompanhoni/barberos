import type { FormaRecebimento, Prisma } from "@prisma/client";
import { auditar } from "@/lib/auditoria";
import { exigirPermissao, permissoesDe } from "@/lib/auth/permissoes";
import { BALCAO, type Sessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { ErroNegocio, naoEncontrado, proibido } from "@/lib/erros";
import { publicar } from "@/lib/eventos";
import { movimentar } from "./estoque";
import { configuracao } from "@/lib/agenda/carregar";
import { linkAbsoluto } from "@/lib/assinaturas/cobrancas";
import { aplicarNaComanda, sincronizarAntecipado } from "@/lib/agenda/antecipado";
import { estornosDaComanda } from "@/lib/estornos/servico";
import { devolverPremiosDaComanda } from "@/lib/jogos/comanda";
import { cancelarAdicionalDoItem } from "./adicional";
import { descricaoServico, erroNoPagamento, resumoComanda, valorCashback } from "./regras";

type Tx = Prisma.TransactionClient;

const INCLUIR = {
  cliente: { select: { id: true, nome: true, telefone: true } },
  itens: { orderBy: { criadoEm: "asc" }, include: { produto: { select: { nome: true, categoria: true, estoque: true } } } },
  pagamentos: { orderBy: { criadoEm: "asc" } },
  linksPagamento: { where: { status: "PENDENTE" }, orderBy: { criadoEm: "asc" }, select: { id: true, token: true, valorCentavos: true, expiraEm: true, criadoEm: true } },
} satisfies Prisma.ComandaInclude;

/** Trava a comanda ate o fim da transacao (dois caixas nao mexem ao mesmo tempo). */
async function travar(tx: Tx, comandaId: string, precisaAberta = true) {
  await tx.$queryRaw`SELECT 1 FROM comandas WHERE id = ${comandaId} FOR UPDATE`;
  const c = await tx.comanda.findUnique({ where: { id: comandaId }, include: INCLUIR });
  if (!c) throw naoEncontrado("Comanda");
  if (precisaAberta && c.status !== "ABERTA") throw new ErroNegocio("Essa comanda já foi fechada.");
  return c;
}

const avisar = (comandaId: string) => publicar({ tipo: "comanda", comandaId });
/** Comanda encerrada: links de pagamento dela em aberto deixam de valer (em segundo plano). */
const encerrarLinks = (comandaId: string) =>
  void import("@/lib/links/servico").then((m) => m.cancelarLinksDaComanda(comandaId)).catch((e) => console.error("[comandas] links", comandaId, e));
const gerente = (s: Sessao) => BALCAO.includes(s.papel);

export async function detalheComanda(id: string) {
  const c = await db.comanda.findUnique({ where: { id }, include: INCLUIR });
  if (!c) throw naoEncontrado("Comanda");
  // Saldo do cliente (cashback + indicacao) que ainda nao venceu, para usar como desconto.
  const saldoCliente = c.clienteId && c.status === "ABERTA"
    ? ((await db.beneficio.aggregate({
        where: { clienteId: c.clienteId, status: "DISPONIVEL", OR: [{ expiraEm: null }, { expiraEm: { gt: new Date() } }] },
        _sum: { valorCentavos: true },
      }))._sum.valorCentavos ?? 0)
    : 0;
  // Links de pagamento em aberto (com o endereco publico para copiar).
  const linksPagamento = c.linksPagamento.map((l) => ({ ...l, url: linkAbsoluto(`/c/link/${l.token}`) }));
  // Pedidos de estorno dos pagamentos desta comanda (pendentes e feitos).
  const estornos = await estornosDaComanda(id);
  // Premios de jogo: os abertos do cliente (para validar) e os ja usados nesta comanda.
  const premios = c.clienteId
    ? await db.premioGanho.findMany({
        where: { OR: [{ comandaId: id }, ...(c.status === "ABERTA" ? [{ clienteId: c.clienteId, status: { in: ["DISPONIVEL" as const, "RESERVADO" as const] }, tipo: { not: "CREDITO" as const }, OR: [{ expiraEm: null }, { expiraEm: { gt: new Date() } }, { status: "RESERVADO" as const }] }] : [])] },
        orderBy: { criadoEm: "asc" },
        select: { id: true, codigo: true, rotulo: true, tipo: true, raridade: true, icone: true, percentual: true, valorCentavos: true, status: true, expiraEm: true, descontoAplicadoCentavos: true, comandaId: true },
      })
    : [];
  return { ...c, linksPagamento, saldoCliente, estornos, premios, resumo: resumoComanda(c.itens, c.pagamentos, c.descontoCentavos) };
}

/** Comandas abertas + as fechadas/canceladas de um dia (padrao: hoje). */
export async function listarComandas(desde: Date) {
  const cs = await db.comanda.findMany({
    where: { OR: [{ status: "ABERTA" }, { fechadaEm: { gte: desde } }, { status: "CANCELADA", abertaEm: { gte: desde } }] },
    orderBy: [{ status: "asc" }, { numero: "desc" }],
    include: INCLUIR,
  });
  return cs.map((c) => ({ ...c, resumo: resumoComanda(c.itens, c.pagamentos, c.descontoCentavos) }));
}

/** Histórico operacional: concluir um corte não inventa pagamento nem altera o caixa. */
export async function atendimentosSemComanda(desde: Date) {
  return db.agendamento.findMany({
    where: { status: "CONCLUIDO", inicio: { gte: desde, lte: new Date() }, adicionalDeId: null, itemComanda: null },
    select: { id: true, inicio: true, precoCentavos: true, assinaturaId: true,
      cliente: { select: { nome: true } }, barbeiro: { select: { nome: true } }, servico: { select: { nome: true } } },
    orderBy: { inicio: "desc" },
  });
}

/**
 * Abre uma comanda. Vindo de um atendimento da agenda, o servico ja entra como item;
 * se o cliente ja tem comanda aberta, o atendimento entra nela (ex.: corte + barba).
 */
export async function abrirComanda(s: Sessao, a: { clienteId?: string | null; nomeAvulso?: string | null; agendamentoId?: string | null }) {
  // Pagou antes pelo link e o aviso ainda nao chegou: confere agora.
  if (a.agendamentoId) {
    const ant = await db.pagamentoAntecipado.findUnique({ where: { agendamentoId: a.agendamentoId }, select: { id: true, status: true } });
    if (ant?.status === "PENDENTE") await sincronizarAntecipado(ant.id);
  }
  const r = await db.$transaction(async (tx) => {
    let clienteId = a.clienteId ?? null;
    let ag: Prisma.AgendamentoGetPayload<{ include: { servico: true; barbeiro: true; itemComanda: true } }> | null = null;
    if (a.agendamentoId) {
      ag = await tx.agendamento.findUnique({ where: { id: a.agendamentoId }, include: { servico: true, barbeiro: true, itemComanda: true } });
      if (!ag) throw naoEncontrado("Atendimento");
      if (ag.itemComanda) return { id: ag.itemComanda.comandaId, nova: false };
      if (ag.status === "CANCELADO" || ag.status === "FALTOU") throw new ErroNegocio("Esse atendimento foi cancelado ou o cliente faltou.");
      clienteId = ag.clienteId;
    }
    if (!clienteId && !a.nomeAvulso?.trim()) throw new ErroNegocio("Escolha o cliente ou digite um nome.");

    const existente = clienteId ? await tx.comanda.findFirst({ where: { clienteId, status: "ABERTA" }, orderBy: { abertaEm: "desc" } }) : null;
    const comanda = existente ?? (await tx.comanda.create({ data: { clienteId, nomeAvulso: clienteId ? null : a.nomeAvulso!.trim(), abertaPorId: s.usuarioId } }));
    if (ag) {
      await tx.itemComanda.create({
        data: {
          comandaId: comanda.id,
          agendamentoId: ag.id,
          descricao: descricaoServico(ag.servico.nome, ag.barbeiro.nome, !!ag.assinaturaId),
          quantidade: 1,
          precoUnitCentavos: ag.precoCentavos,
          barbeiroId: ag.barbeiroId,
        },
      });
      const antecipado = await tx.pagamentoAntecipado.findUnique({ where: { agendamentoId: ag.id } });
      if (antecipado?.status === "PAGO") await aplicarNaComanda(tx, comanda.id, antecipado);
    }
    if (!existente) await auditar(tx, s.usuarioId, "abrir", "comanda", comanda.id, { agendamentoId: a.agendamentoId ?? null });
    return { id: comanda.id, nova: !existente };
  });
  avisar(r.id);
  return r;
}

export async function adicionarProduto(s: Sessao, comandaId: string, produtoId: string, quantidade: number) {
  if (!Number.isInteger(quantidade) || quantidade <= 0) throw new ErroNegocio("Quantidade inválida.");
  await db.$transaction(async (tx) => {
    const c = await travar(tx, comandaId);
    const p = await tx.produto.findUnique({ where: { id: produtoId } });
    if (!p || !p.ativo) throw naoEncontrado("Produto");
    if (p.categoria === "USO_INTERNO") throw new ErroNegocio("Produto de uso interno não é vendido na comanda.");
    // Mesmo produto de novo: soma na linha que ja existe.
    const linha = c.itens.find((i) => i.produtoId === produtoId && i.precoUnitCentavos === p.precoCentavos);
    if (linha) await tx.itemComanda.update({ where: { id: linha.id }, data: { quantidade: linha.quantidade + quantidade } });
    else await tx.itemComanda.create({ data: { comandaId, produtoId, descricao: p.nome, quantidade, precoUnitCentavos: p.precoCentavos, barbeiroId: s.barbeiroId } });
  });
  avisar(comandaId);
}

export async function adicionarAvulso(s: Sessao, comandaId: string, descricao: string, precoUnitCentavos: number, quantidade: number) {
  if (!gerente(s)) throw proibido();
  await db.$transaction(async (tx) => {
    await travar(tx, comandaId);
    await tx.itemComanda.create({ data: { comandaId, descricao, quantidade, precoUnitCentavos, barbeiroId: s.barbeiroId } });
  });
  avisar(comandaId);
}

/** Muda a quantidade de um item (0 remove). Servico da agenda so pode ser removido. */
export async function alterarItem(s: Sessao, itemId: string, quantidade: number) {
  const item = await db.itemComanda.findUnique({ where: { id: itemId } });
  if (!item) throw naoEncontrado("Item");
  await db.$transaction(async (tx) => {
    await travar(tx, item.comandaId);
    if (quantidade <= 0) {
      await tx.itemComanda.delete({ where: { id: itemId } });
      // Servico adicional lancado na comanda: o atendimento adicional sai junto.
      await cancelarAdicionalDoItem(tx, item.agendamentoId);
      await auditar(tx, s.usuarioId, "remover_item", "comanda", item.comandaId, { descricao: item.descricao, quantidade: item.quantidade });
      return;
    }
    if (item.agendamentoId) throw new ErroNegocio("Serviço da agenda entra uma vez só.");
    await tx.itemComanda.update({ where: { id: itemId }, data: { quantidade } });
  });
  avisar(item.comandaId);
}

export async function definirDesconto(s: Sessao, comandaId: string, descontoCentavos: number) {
  await exigirPermissao(s, "desconto");
  await db.$transaction(async (tx) => {
    const c = await travar(tx, comandaId);
    const { subtotal } = resumoComanda(c.itens, c.pagamentos, 0);
    if (descontoCentavos < 0 || descontoCentavos > subtotal) throw new ErroNegocio("Desconto maior que o total.");
    await tx.comanda.update({ where: { id: comandaId }, data: { descontoCentavos } });
    await auditar(tx, s.usuarioId, "desconto", "comanda", comandaId, { comanda: c.numero, antes: { descontoCentavos: c.descontoCentavos }, depois: { descontoCentavos } });
  });
  avisar(comandaId);
}

/**
 * Lanca um pagamento. `status` AGUARDANDO = foi mandado para a maquininha e ainda nao passou.
 * Quem chama decide (ver maquininha.ts); aqui so valida os valores.
 */
export async function lancarPagamento(
  tx: Tx,
  s: Sessao,
  comandaId: string,
  p: { forma: FormaRecebimento; valorCentavos: number; status: "AGUARDANDO" | "PAGO" },
) {
  const c = await travar(tx, comandaId);
  const r = resumoComanda(c.itens, c.pagamentos, c.descontoCentavos);
  const erro = erroNoPagamento(p.forma, p.valorCentavos, r.falta);
  if (erro) throw new ErroNegocio(erro);
  const pg = await tx.pagamentoComanda.create({
    data: { comandaId, forma: p.forma, valorCentavos: p.valorCentavos, status: p.status, registradoPorId: s.usuarioId, pagoEm: p.status === "PAGO" ? new Date() : null },
  });
  await auditar(tx, s.usuarioId, "pagamento", "comanda", comandaId, { forma: p.forma, valorCentavos: p.valorCentavos, status: p.status });
  return { comanda: c, pagamento: pg };
}

/** Fecha: baixa o estoque dos produtos vendidos. Precisa estar paga (ou total zero). */
export async function fecharComanda(s: Sessao, comandaId: string) {
  const r = await db.$transaction(async (tx) => {
    const c = await travar(tx, comandaId);
    if (c.itens.length === 0) throw new ErroNegocio("A comanda está vazia.");
    const res = resumoComanda(c.itens, c.pagamentos, c.descontoCentavos);
    if (res.aguardando > 0) throw new ErroNegocio("Tem pagamento esperando na maquininha.");
    if (!res.podeFechar) throw new ErroNegocio(`Ainda falta receber ${(res.falta / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}.`);
    const alertas: string[] = [];
    for (const i of c.itens) {
      if (!i.produtoId) continue;
      const m = await movimentar(tx, { produtoId: i.produtoId, tipo: "VENDA", quantidade: -i.quantidade, usuarioId: s.usuarioId, comandaId, motivo: `Comanda #${c.numero}` });
      if (m && m.saldoApos < 0) alertas.push(`${i.descricao}: estoque ficou negativo (${m.saldoApos}). Confira a contagem.`);
    }
    await tx.comanda.update({ where: { id: comandaId }, data: { status: "FECHADA", fechadaEm: new Date() } });
    // Cashback: % do que o cliente pagou volta como saldo (uma vez por comanda).
    const cfg = await configuracao();
    const cashback = cfg.cashbackAtivo && c.clienteId ? valorCashback(res.total, cfg.cashbackPct) : 0;
    if (cashback > 0) {
      await tx.beneficio.create({
        data: {
          clienteId: c.clienteId!, descricao: `Cashback da comanda #${c.numero}`, valorCentavos: cashback, motivo: "CASHBACK",
          comandaOrigemId: comandaId, expiraEm: new Date(Date.now() + cfg.cashbackValidadeDias * 86_400_000),
        },
      });
    }
    await auditar(tx, s.usuarioId, "fechar", "comanda", comandaId, { total: res.total, troco: res.troco, cashback });
    return { troco: res.troco, alertas, cashbackCentavos: cashback };
  });
  avisar(comandaId);
  encerrarLinks(comandaId);
  return r;
}

/**
 * Cancela. Aberta: so sem pagamento recebido. Fechada (permissao "excluir"): devolve os produtos ao estoque;
 * o dinheiro/cartao ja recebido precisa ser devolvido por fora (estorno na maquininha).
 */
export async function cancelarComanda(s: Sessao, comandaId: string, motivo: string) {
  const podeFechada = (await permissoesDe(s.papel)).excluir;
  await db.$transaction(async (tx) => {
    const c = await travar(tx, comandaId, false);
    if (c.status === "CANCELADA") return;
    if (c.status === "FECHADA") {
      if (!podeFechada) throw new ErroNegocio("Só o dono (ou quem tem a permissão de excluir) cancela comanda já fechada.", 403, "proibido");
      for (const i of c.itens) {
        if (i.produtoId) await movimentar(tx, { produtoId: i.produtoId, tipo: "ESTORNO", quantidade: i.quantidade, usuarioId: s.usuarioId, comandaId, motivo: `Cancelou comanda #${c.numero}` });
      }
    } else {
      if (!gerente(s)) throw proibido();
      if (c.pagamentos.some((p) => p.status !== "CANCELADO")) throw new ErroNegocio("Cancele os pagamentos lançados antes de cancelar a comanda.");
    }
    await tx.comanda.update({ where: { id: comandaId }, data: { status: "CANCELADA" } });
    // Desconto de indicacao usado nessa comanda volta para o cliente.
    await tx.beneficio.updateMany({ where: { comandaId, status: "USADO" }, data: { status: "DISPONIVEL", usadoEm: null, comandaId: null } });
    // Premio de jogo validado nessa comanda (servico gratis, desconto, brinde) volta para o cliente.
    await devolverPremiosDaComanda(tx, comandaId);
    // Cashback que essa comanda gerou e ainda nao foi usado deixa de valer.
    const gerados = await tx.beneficio.findMany({ where: { comandaOrigemId: comandaId }, select: { id: true } });
    if (gerados.length) {
      const ids = gerados.map((g) => g.id);
      await tx.beneficio.updateMany({ where: { status: "DISPONIVEL", OR: [{ id: { in: ids } }, { origemBeneficioId: { in: ids } }] }, data: { status: "CANCELADO" } });
    }
    await auditar(tx, s.usuarioId, "cancelar", "comanda", comandaId, { motivo, estavaFechada: c.status === "FECHADA" });
  });
  avisar(comandaId);
  encerrarLinks(comandaId);
}

export { avisar as avisarComanda, gerente as ehGerente };
