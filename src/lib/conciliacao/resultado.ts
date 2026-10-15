/**
 * Resultado do mes lado a lado: o faturamento registrado no BarberOS, o que caiu na Celcash (com taxas,
 * antecipacao, tarifas e estornos), o que saiu dela (transferencias para a empresa e pagamentos a terceiros)
 * e o lucro, com as divergencias marcadas.
 */
import type { Sessao } from "@/lib/auth/sessao";
import { auditar } from "@/lib/auditoria";
import { db } from "@/lib/db";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import { janelaMes } from "@/lib/financeiro/despesas";
import { resumoMes } from "@/lib/financeiro/resumo";
import { divergente, resumirExtrato, type TipoExterno } from "./regras";

/** Categorias de saida que NAO sao despesa da operacao (nao entram no lucro). */
export const NAO_DESPESA = ["RETIRADA_SOCIO", "JA_LANCADA"] as const;

export async function resultadoDoMes(mes: string) {
  const janela = await janelaMes(mes);
  const [r, movs, ultimo] = await Promise.all([
    resumoMes(mes),
    db.movimentoExterno.findMany({ where: { fonte: "CELCASH", data: { gte: janela.gte, lt: janela.lt } }, select: { tipo: true, forma: true, valorCentavos: true, categoria: true } }),
    db.movimentoExterno.findFirst({ where: { fonte: "CELCASH" }, orderBy: { data: "desc" }, select: { data: true } }),
  ]);
  const celcash = resumirExtrato(movs);
  const pagamentosDespesa = -movs.filter((m) => m.tipo === "PAGAMENTO" && m.categoria && !(NAO_DESPESA as readonly string[]).includes(m.categoria)).reduce((t, m) => t + m.valorCentavos, 0);
  const retiradas = -movs.filter((m) => m.tipo === "PAGAMENTO" && m.categoria === "RETIRADA_SOCIO").reduce((t, m) => t + m.valorCentavos, 0);

  // O que deveria ter caido na Celcash: as mensalidades registradas (os planos sao cobrados por ela).
  const mensalidades = r.receitas.mensalidades.total;
  const despesas = r.despesas.total + pagamentosDespesa;
  const lucro = r.receitas.total - celcash.custoGateway - despesas;
  const alertas: string[] = [];
  if (divergente(mensalidades, celcash.recebido)) {
    alertas.push(`Mensalidades registradas (${reais(mensalidades)}) diferentes do que caiu na Celcash (${reais(celcash.recebido)}): diferença de ${reais(celcash.recebido - mensalidades)}.`);
  }
  if (celcash.pagamentosSemCategoria > 0) alertas.push(`${reais(celcash.pagamentosSemCategoria)} saíram da Celcash para terceiros sem categoria: classifique para entrar no lucro.`);
  if (celcash.outros !== 0) alertas.push(`${reais(celcash.outros)} em movimentos da Celcash sem tipo conhecido.`);

  return {
    mes,
    sincronizadoAte: ultimo?.data ?? null,
    registrado: {
      total: r.receitas.total,
      comandas: r.receitas.comandas.total,
      porForma: r.receitas.comandas.porForma,
      mensalidades,
      antecipados: r.receitas.antecipados.total,
      links: r.receitas.links.total,
      estornos: r.receitas.estornos.total,
    },
    celcash: { ...celcash, pagamentosDespesa, retiradas },
    despesas: { barberos: r.despesas.total, porCategoria: r.despesas.porCategoria, celcash: pagamentosDespesa, total: despesas },
    lucro,
    divergencias: { mensalidades: celcash.recebido - mensalidades },
    alertas,
  };
}

const reais = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Movimentos externos do mes (para conferir e classificar). */
export async function movimentosDoMes(mes: string, tipo?: TipoExterno) {
  const janela = await janelaMes(mes);
  return db.movimentoExterno.findMany({
    where: { data: { gte: janela.gte, lt: janela.lt }, ...(tipo ? { tipo } : {}) },
    orderBy: { data: "desc" }, take: 2000,
    select: { id: true, fonte: true, data: true, valorCentavos: true, tipo: true, forma: true, descricao: true, categoria: true, observacao: true, classificadoPorId: true },
  });
}

/** O dono corrige o tipo/categoria de um movimento (a sincronizacao nao desfaz). */
export async function classificarMovimento(s: Sessao, id: string, d: { tipo: TipoExterno; categoria: string | null; observacao?: string | null }) {
  const m = await db.movimentoExterno.findUnique({ where: { id } });
  if (!m) throw naoEncontrado("Movimento");
  if (d.tipo === "PAGAMENTO" && m.valorCentavos > 0) throw new ErroNegocio("Entrada não pode ser pagamento.");
  await db.$transaction(async (tx) => {
    await tx.movimentoExterno.update({ where: { id }, data: { tipo: d.tipo, categoria: d.tipo === "PAGAMENTO" ? d.categoria : null, observacao: d.observacao ?? m.observacao, classificadoPorId: s.usuarioId } });
    await auditar(tx, s.usuarioId, "conciliacao_classificar", "movimento_externo", id, { antes: { tipo: m.tipo, categoria: m.categoria }, depois: { tipo: d.tipo, categoria: d.categoria }, descricao: m.descricao });
  });
}
