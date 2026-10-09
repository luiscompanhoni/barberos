/**
 * Estornos: a recepcao pede (fica PENDENTE e o dono e avisado no WhatsApp); o dono aprova,
 * recusa ou estorna direto. Aprovado, o sistema executa (ver executar.ts).
 */
import type { PedidoEstorno, Prisma } from "@prisma/client";
import { auditar } from "@/lib/auditoria";
import type { Sessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { urlPainel } from "@/lib/dominios";
import { ErroNegocio, naoEncontrado, proibido } from "@/lib/erros";
import { caixaAberto } from "@/lib/financeiro/caixa";
import { notificarCliente } from "@/lib/whatsapp/conversas";
import { carregarAlvo, exigirEstornavel, type Alvo } from "./alvo";
import { executarEstorno, registrarManual } from "./executar";
import { aceitaParcial, erroNoPedido, limiteEstorno, STATUS_ATIVOS, textoAvisoDono, type TipoEstorno } from "./regras";

type Tx = Prisma.TransactionClient;
const ehDono = (s: Sessao) => s.papel === "DONO";
const exigirGerente = (s: Sessao) => { if (s.papel !== "DONO" && s.papel !== "RECEPCAO") throw proibido(); };

/** Quanto ainda da para estornar do alvo (desconta pedidos em andamento e ja estornados). */
async function limiteDoAlvo(tx: Tx | typeof db, a: Alvo) {
  const ja = await tx.pedidoEstorno.aggregate({ where: { tipo: a.tipo, referenciaId: a.referenciaId, status: { in: STATUS_ATIVOS } }, _sum: { valorCentavos: true } });
  // Na comanda, pedidos ainda nao executados de outros pagamentos tambem seguram o liquido.
  let liquido = a.liquidoComanda;
  if (liquido !== null && a.comandaId) {
    const emAndamento = await tx.pedidoEstorno.aggregate({ where: { comandaId: a.comandaId, status: { in: ["PENDENTE", "APROVADO"] } }, _sum: { valorCentavos: true } });
    liquido -= emAndamento._sum.valorCentavos ?? 0;
  }
  return limiteEstorno({ valorCentavos: a.valorOriginal, jaPedido: ja._sum.valorCentavos ?? 0, liquidoComanda: liquido });
}

/** Dados para a tela de pedir/estornar (valor maximo, meio, se aceita parcial, pedidos existentes). */
export async function infoAlvo(s: Sessao, tipo: TipoEstorno, id: string) {
  exigirGerente(s);
  const a = await carregarAlvo(tipo, id);
  const pedidos = await db.pedidoEstorno.findMany({ where: { tipo: a.tipo, referenciaId: a.referenciaId }, orderBy: { criadoEm: "desc" } });
  return {
    tipo: a.tipo, referenciaId: a.referenciaId, descricao: a.descricao, clienteNome: a.clienteNome, valorOriginal: a.valorOriginal,
    meio: a.meio, forma: a.forma, parcial: aceitaParcial(a.meio, a.tipo), limite: a.bloqueio ? 0 : await limiteDoAlvo(db, a), bloqueio: a.bloqueio,
    exigeCaixa: a.meio === "DINHEIRO", caixaAberto: a.meio === "DINHEIRO" ? !!(await caixaAberto()) : null,
    pedidos: pedidos.map(paraTela),
  };
}

/**
 * Recepcao: cria o pedido PENDENTE e avisa o dono. Dono: estorna direto (aprovado por ele) e executa.
 */
export async function pedirEstorno(s: Sessao, p: { tipo: TipoEstorno; referenciaId: string; valorCentavos: number; motivo: string }) {
  exigirGerente(s);
  const motivo = p.motivo.trim();
  const pedido = await db.$transaction(async (tx) => {
    const alvo = await carregarAlvo(p.tipo, p.referenciaId, tx);
    // Um pedido por vez para o mesmo pagamento (dois cliques ou duas telas): trava e le de novo.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`estorno:${alvo.tipo}:${alvo.referenciaId}`}))`;
    const a = await carregarAlvo(alvo.tipo, alvo.referenciaId, tx);
    exigirEstornavel(a);
    const erro = erroNoPedido({ valorCentavos: p.valorCentavos, limite: await limiteDoAlvo(tx, a), motivo, parcialPermitido: aceitaParcial(a.meio, a.tipo), valorOriginal: a.valorOriginal });
    if (erro) throw new ErroNegocio(erro);
    if (a.meio === "DINHEIRO" && !(await tx.caixa.findFirst({ where: { status: "ABERTO" } }))) {
      throw new ErroNegocio("Estorno em dinheiro sai do caixa: abra o caixa primeiro.", 409, "caixa_fechado");
    }
    const agora = new Date();
    const novo = await tx.pedidoEstorno.create({
      data: {
        tipo: a.tipo, referenciaId: a.referenciaId, valorCentavos: p.valorCentavos, valorOriginalCentavos: a.valorOriginal, motivo,
        meio: a.meio, forma: a.forma, descricao: a.descricao, comandaId: a.comandaId, clienteNome: a.clienteNome, pedidoPorId: s.usuarioId,
        ...(ehDono(s) ? { status: "APROVADO" as const, decididoPorId: s.usuarioId, decididoEm: agora, motivoDecisao: "Estorno direto do dono" } : {}),
      },
    });
    await auditar(tx, s.usuarioId, ehDono(s) ? "estorno_direto" : "estorno_pedido", "estorno", novo.id, {
      tipo: a.tipo, referenciaId: a.referenciaId, valorCentavos: p.valorCentavos, motivo, meio: a.meio,
    });
    return novo;
  });
  if (ehDono(s)) return paraTela(await executarEstorno(s, pedido.id));
  await avisarDonos(s, pedido);
  return paraTela(pedido);
}

/** Aviso no WhatsApp de cada dono ativo (com o link do painel). Nao trava o pedido. */
async function avisarDonos(s: Sessao, p: PedidoEstorno) {
  const donos = await db.usuario.findMany({ where: { papel: "DONO", ativo: true }, select: { telefone: true } });
  const texto = textoAvisoDono({ pedidoPor: s.nome, descricao: p.descricao, valorCentavos: p.valorCentavos, motivo: p.motivo, link: `${urlPainel()}/financeiro?aba=estornos` });
  await Promise.all(donos.map((d) => notificarCliente(d.telefone, texto).catch((e) => console.error("[estornos] aviso ao dono", e))));
}

/** Dono decide: aprovar (executa), recusar (com motivo), tentar de novo (falhou) ou registrar que devolveu por fora. */
export async function decidirEstorno(s: Sessao, id: string, d: { acao: "aprovar" | "recusar" | "tentar" | "manual"; motivo?: string | null }) {
  if (!ehDono(s)) throw new ErroNegocio("Só o dono aprova ou recusa estornos.", 403, "proibido");
  const p = await db.pedidoEstorno.findUnique({ where: { id } });
  if (!p) throw naoEncontrado("Pedido de estorno");
  const motivo = d.motivo?.trim() || null;

  if (d.acao === "recusar") {
    if (!motivo || motivo.length < 3) throw new ErroNegocio("Escreva o motivo da recusa.");
    await transicao(s, p, "PENDENTE", { status: "RECUSADO", motivoDecisao: motivo }, "estorno_recusado");
    return paraTela(await db.pedidoEstorno.findUniqueOrThrow({ where: { id } }));
  }
  if (d.acao === "manual") {
    if (p.status !== "FALHOU") throw new ErroNegocio("Só dá para registrar por fora um estorno que falhou.", 409);
    return paraTela(await registrarManual(s, id, motivo));
  }
  if (d.acao === "aprovar") await transicao(s, p, "PENDENTE", { status: "APROVADO", motivoDecisao: motivo }, "estorno_aprovado");
  else await transicao(s, p, "FALHOU", { status: "APROVADO", erro: null }, "estorno_tentar_de_novo");
  return paraTela(await executarEstorno(s, id));
}

/** Muda o status so se ainda estiver no esperado (dois cliques nao executam duas vezes). */
async function transicao(s: Sessao, p: PedidoEstorno, de: PedidoEstorno["status"], data: Prisma.PedidoEstornoUpdateManyMutationInput, acao: string) {
  await db.$transaction(async (tx) => {
    const ok = await tx.pedidoEstorno.updateMany({ where: { id: p.id, status: de }, data: { ...data, decididoPorId: s.usuarioId, decididoEm: new Date() } });
    if (!ok.count) throw new ErroNegocio("Esse pedido já foi decidido. Atualize a tela.", 409, "ja_decidido");
    await auditar(tx, s.usuarioId, acao, "estorno", p.id, { valorCentavos: p.valorCentavos, motivo: (data.motivoDecisao as string | null | undefined) ?? null });
  });
}

// ---------------------------------------------------------------- consultas

function paraTela(p: PedidoEstorno & { pedidoPor?: string | null; decididoPor?: string | null }) {
  return {
    id: p.id, tipo: p.tipo, referenciaId: p.referenciaId, valorCentavos: p.valorCentavos, valorOriginalCentavos: p.valorOriginalCentavos,
    parcial: p.valorCentavos < p.valorOriginalCentavos, motivo: p.motivo, status: p.status, meio: p.meio, forma: p.forma, descricao: p.descricao,
    comandaId: p.comandaId, clienteNome: p.clienteNome, motivoDecisao: p.motivoDecisao, instrucao: p.instrucao, erro: p.erro,
    gatewayEstornoId: p.gatewayEstornoId, criadoEm: p.criadoEm, decididoEm: p.decididoEm, executadoEm: p.executadoEm,
    pedidoPor: p.pedidoPor ?? null, decididoPor: p.decididoPor ?? null,
  };
}
export type EstornoTela = ReturnType<typeof paraTela>;

/** Pendentes no topo e o historico recente (com os nomes de quem pediu/decidiu). */
export async function listarEstornos(s: Sessao) {
  exigirGerente(s);
  const [pendentes, historico] = await Promise.all([
    db.pedidoEstorno.findMany({ where: { status: { in: ["PENDENTE", "FALHOU", "APROVADO"] } }, orderBy: { criadoEm: "asc" } }),
    db.pedidoEstorno.findMany({ where: { status: { in: ["EXECUTADO", "MANUAL", "RECUSADO"] } }, orderBy: { criadoEm: "desc" }, take: 100 }),
  ]);
  const ids = [...pendentes, ...historico].flatMap((p) => [p.pedidoPorId, p.decididoPorId]).filter((x): x is string => !!x);
  const nomes = new Map((await db.usuario.findMany({ where: { id: { in: ids } }, select: { id: true, nome: true } })).map((u) => [u.id, u.nome]));
  const com = (p: PedidoEstorno) => paraTela({ ...p, pedidoPor: nomes.get(p.pedidoPorId ?? "") ?? null, decididoPor: nomes.get(p.decididoPorId ?? "") ?? null });
  return { pendentes: pendentes.map(com), historico: historico.map(com), dono: ehDono(s) };
}

/** Selo do painel: pedidos esperando o dono. */
export const contarPendentes = () => db.pedidoEstorno.count({ where: { status: "PENDENTE" } });

/** Pedidos ligados aos pagamentos de uma comanda (para mostrar na tela dela). */
export async function estornosDaComanda(comandaId: string) {
  const lista = await db.pedidoEstorno.findMany({ where: { comandaId }, orderBy: { criadoEm: "asc" } });
  return lista.map((p) => paraTela(p));
}
