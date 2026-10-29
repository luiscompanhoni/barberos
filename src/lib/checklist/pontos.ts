/**
 * Pontuacao do checklist: o gerente valida (ganha os pontos da tarefa) ou da "re" (marcou feito
 * sem fazer: perde pontos e a tarefa volta para nao feita). Faixas BLACK ELITE/PLATINA/LEGEND.
 */
import { configuracao } from "@/lib/agenda/carregar";
import { dataLocal, instanteLocal, somarDias } from "@/lib/agenda/tempo";
import { auditar } from "@/lib/auditoria";
import type { Prisma } from "@prisma/client";
import type { Sessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { travarCompetencia } from "@/lib/desempenho/acesso";
import { urlPainel } from "@/lib/dominios";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import { notificarCliente } from "@/lib/whatsapp/conversas";
import { mudancasDeFaixa, progressoNivel, textoRe, type LimitesNivel } from "./regras";

export type Avaliacao = "VALIDADO" | "RE";

async function limites(): Promise<LimitesNivel & { pontosRe: number }> {
  const c = await db.checklistConfig.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
  return { pontosRe: c.pontosRe, nivelPlatina: c.nivelPlatina, nivelLegend: c.nivelLegend };
}

/** Total acumulado de pontos por pessoa. */
export async function totaisDePontos(pessoaIds?: string[]) {
  const g = await db.checklistPonto.groupBy({ by: ["pessoaId"], _sum: { pontos: true }, ...(pessoaIds ? { where: { pessoaId: { in: pessoaIds } } } : {}) });
  return new Map(g.map((x) => [x.pessoaId, x._sum.pontos ?? 0]));
}

/**
 * Quem muda de faixa se os limites mudarem: com os pontos de hoje e, para quem participa do bônus e ainda não teve o
 * mês anterior aprovado, com os pontos até o fim daquele mês (o bônus pendente é calculado com os limites atuais).
 */
export async function previaDeFaixas(de: LimitesNivel, para: LimitesNivel) {
  const fuso = (await configuracao()).fuso;
  const mes = dataLocal(Date.now(), fuso).slice(0, 7), anterior = somarDias(`${mes}-01`, -1).slice(0, 7);
  const [pessoas, totais, ateAnterior, participantes, aprovados] = await Promise.all([
    db.checklistPessoa.findMany({ where: { ativo: true }, select: { id: true, nome: true } }),
    totaisDePontos(),
    db.checklistPonto.groupBy({ by: ["pessoaId"], _sum: { pontos: true }, where: { criadoEm: { lt: new Date(instanteLocal(`${mes}-01`, 0, fuso)) } } }),
    db.desempenhoAdesao.findMany({ where: { aceitaEm: { not: null }, inicio: { lt: `${mes}-01` } }, select: { pessoaId: true }, distinct: ["pessoaId"] }),
    db.desempenhoBonus.findMany({ where: { competencia: anterior }, select: { pessoaId: true } }),
  ]);
  const pontosAnterior = new Map(ateAnterior.map((x) => [x.pessoaId, x._sum.pontos ?? 0]));
  const pendentes = new Set(participantes.map((a) => a.pessoaId));
  for (const b of aprovados) pendentes.delete(b.pessoaId);
  return [
    ...mudancasDeFaixa(pessoas.map((p) => ({ nome: p.nome, pontos: totais.get(p.id) ?? 0 })), de, para).map((m) => ({ ...m, quando: "agora" })),
    ...mudancasDeFaixa(pessoas.filter((p) => pendentes.has(p.id)).map((p) => ({ nome: p.nome, pontos: pontosAnterior.get(p.id) ?? 0 })), de, para).map((m) => ({ ...m, quando: anterior })),
  ];
}

/** Pontos de mês com bônus ou folha fechados não mudam; para corrigir, faz-se um ajuste de pontos no mês atual. */
export async function travarPontoDoItem(tx: Prisma.TransactionClient, itemId: string) {
  const ponto = await tx.checklistPonto.findUnique({ where: { itemId } });
  if (!ponto) return;
  const competencia = dataLocal(ponto.criadoEm, (await configuracao(tx)).fuso).slice(0, 7);
  try {
    await travarCompetencia(tx, ponto.pessoaId, competencia);
  } catch (e) {
    if (e instanceof ErroNegocio && e.codigo === "competencia_fechada") {
      throw new ErroNegocio("Essa pontuação é de um mês já fechado (bônus ou folha). Para corrigir, faça um ajuste de pontos com o motivo.", 409, "competencia_fechada");
    }
    throw e;
  }
}

/** Pontos, faixa e progresso de uma pessoa (link publico e ficha do RH). */
export async function resumoPontos(pessoaId: string) {
  const [cfg, totais] = await Promise.all([limites(), totaisDePontos([pessoaId])]);
  const pontos = totais.get(pessoaId) ?? 0;
  return { pontos, ...progressoNivel(pontos, cfg) };
}

/** Gerente avalia uma tarefa (null desfaz a avaliacao). Reavaliar substitui o lancamento anterior, na mesma data. */
export async function avaliarItem(s: Sessao, itemId: string, avaliacao: Avaliacao | null, motivo?: string | null) {
  const item = await db.checklistItem.findUnique({ where: { id: itemId }, include: { pessoa: true } });
  if (!item) throw naoEncontrado("Tarefa");
  const cfg = await limites();
  if (avaliacao && !item.feito) throw new ErroNegocio("Essa tarefa não está marcada como feita: não dá para validar nem dar ré.", 409, "nao_feito");
  const pontos = avaliacao === "VALIDADO" ? item.pontos : -cfg.pontosRe;
  const descricao = avaliacao === "VALIDADO" ? `Validada: ${item.titulo}` : `Ré: ${item.titulo}${motivo ? ` (${motivo})` : ""}`;
  await db.$transaction(async (tx) => {
    await travarPontoDoItem(tx, itemId);
    if (!avaliacao) {
      await tx.checklistPonto.deleteMany({ where: { itemId } });
      await tx.checklistItem.update({ where: { id: itemId }, data: { avaliacao: null, avaliadoEm: null, avaliadoPor: null, motivoRe: null } });
    } else {
      await tx.checklistPonto.upsert({
        where: { itemId },
        create: { itemId, pessoaId: item.pessoaId, pontos, descricao, porNome: s.nome },
        update: { pontos, descricao, porNome: s.nome },
      });
      await tx.checklistItem.update({
        where: { id: itemId },
        data: {
          avaliacao, avaliadoEm: new Date(), avaliadoPor: s.nome, motivoRe: avaliacao === "RE" ? motivo || null : null,
          // Re: a tarefa volta para nao feita.
          ...(avaliacao === "RE" ? { feito: false, feitoEm: null, feitoPor: null } : {}),
        },
      });
    }
    await auditar(tx, s.usuarioId, avaliacao ? `checklist_${avaliacao.toLowerCase()}` : "checklist_desfazer_avaliacao", "checklist_item", itemId, { pessoaId: item.pessoaId, pontos: avaliacao ? pontos : 0, motivo: motivo ?? null });
  });
  if (avaliacao === "RE") {
    try {
      await notificarCliente(item.pessoa.telefone, textoRe({ nome: item.pessoa.nome, titulo: item.titulo, pontos: cfg.pontosRe, motivo, link: `${urlPainel()}/t/${item.pessoa.token}` }));
      await db.conversa.updateMany({ where: { telefone: item.pessoa.telefone }, data: { estado: "HUMANO" } });
    } catch (e) {
      console.error("[checklist] aviso de re falhou:", e);
    }
  }
  return { pontos: avaliacao ? pontos : 0 };
}

/** Ajuste manual de pontos (com motivo). */
export async function ajustarPontos(s: Sessao, pessoaId: string, pontos: number, motivo: string) {
  if (!pontos) throw new ErroNegocio("Informe os pontos do ajuste.");
  const p = await db.checklistPessoa.findUnique({ where: { id: pessoaId } });
  if (!p) throw naoEncontrado("Pessoa");
  await db.$transaction(async (tx) => {
    const l = await tx.checklistPonto.create({ data: { pessoaId, pontos, descricao: `Ajuste: ${motivo}`, porNome: s.nome } });
    await auditar(tx, s.usuarioId, "checklist_ajuste_pontos", "checklist_pessoa", pessoaId, { pontos, motivo, lancamentoId: l.id });
  });
}

/** Ranking: total, faixa, pontos do mes e ultimos lancamentos de cada pessoa ativa. */
export async function classificacao() {
  const cfg = await limites();
  const fuso = (await configuracao()).fuso;
  const mes = dataLocal(Date.now(), fuso).slice(0, 7);
  const inicioMes = new Date(instanteLocal(`${mes}-01`, 0, fuso));
  const [pessoas, totais, doMes, ultimos] = await Promise.all([
    db.checklistPessoa.findMany({ where: { ativo: true }, select: { id: true, nome: true, funcao: true } }),
    totaisDePontos(),
    db.checklistPonto.groupBy({ by: ["pessoaId"], _sum: { pontos: true }, where: { criadoEm: { gte: inicioMes } } }),
    db.checklistPonto.findMany({ where: { pessoa: { ativo: true } }, orderBy: { criadoEm: "desc" }, take: 300 }),
  ]);
  const mesMap = new Map(doMes.map((x) => [x.pessoaId, x._sum.pontos ?? 0]));
  const linhas = pessoas.map((p) => {
    const pontos = totais.get(p.id) ?? 0;
    return {
      id: p.id, nome: p.nome, funcao: p.funcao, pontos, pontosMes: mesMap.get(p.id) ?? 0, ...progressoNivel(pontos, cfg),
      extrato: ultimos.filter((u) => u.pessoaId === p.id).slice(0, 8).map((u) => ({ id: u.id, pontos: u.pontos, descricao: u.descricao, porNome: u.porNome, criadoEm: u.criadoEm })),
    };
  }).sort((a, b) => b.pontos - a.pontos || b.pontosMes - a.pontosMes || a.nome.localeCompare(b.nome));
  return { config: cfg, mes, pessoas: linhas };
}
