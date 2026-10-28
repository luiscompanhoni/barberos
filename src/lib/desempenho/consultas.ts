import type { Prisma } from "@prisma/client";
import { configuracao } from "@/lib/agenda/carregar";
import { dataLocal, dataParaColuna, instanteLocal, somarDias } from "@/lib/agenda/tempo";
import { resumoAvaliacaoBarbeiro } from "@/lib/avaliacoes/resumos";
import type { Sessao } from "@/lib/auth/sessao";
import { nivelDoFuncionario } from "@/lib/checklist/regras";
import { db } from "@/lib/db";
import { naoEncontrado } from "@/lib/erros";
import { intervaloCompetencia } from "@/lib/rh/regras";
import { contexto, exigirPessoa } from "./acesso";
import { instanteEfetivo, incluirAjustes } from "./presenca";
import { apurarPresenca, elegibilidade, mediaNotas, proximasMarcacoes } from "./regras";
import { PROGRAMA_INICIAL, zNotas, zPrograma } from "./schemas";
import { memoriaBonus } from "./memoria";

type Banco = Prisma.TransactionClient;

export async function resumoPessoa(pessoaId: string, competencia: string, tx: Banco = db) {
  const { inicio, fim } = intervaloCompetencia(competencia), fuso = (await configuracao()).fuso, agora = Date.now();
  const janela = { gte: new Date(instanteLocal(inicio, 0, fuso)), lt: new Date(instanteLocal(somarDias(fim, 1), 0, fuso)) };
  const [pessoa, regra, adesoes, brutas, justificativas, itens, avaliacoes, pontos, niveis, fechado, ajustes] = await Promise.all([
    tx.checklistPessoa.findUnique({ where: { id: pessoaId }, select: { id: true, nome: true, usuarioId: true, barbeiroId: true, ativo: true } }),
    tx.desempenhoRegra.findFirst({ where: { competenciaInicio: { lte: competencia } }, orderBy: { competenciaInicio: "desc" } }),
    tx.desempenhoAdesao.findMany({ where: { pessoaId, inicio: { lte: fim } }, orderBy: { inicio: "desc" } }),
    tx.presencaMarcacao.findMany({ where: { pessoaId, instante: janela }, include: incluirAjustes, orderBy: { instante: "asc" } }),
    tx.presencaJustificativa.findMany({ where: { pessoaId, data: { gte: inicio, lte: fim } } }),
    tx.checklistItem.findMany({ where: { pessoaId, data: { gte: dataParaColuna(inicio), lte: dataParaColuna(fim) } }, select: { avaliacao: true } }),
    tx.desempenhoAvaliacao.findMany({ where: { pessoaId, data: { gte: inicio, lte: fim } }, orderBy: [{ data: "desc" }, { tipo: "asc" }] }),
    tx.checklistPonto.aggregate({ where: { pessoaId, criadoEm: { lt: janela.lt } }, _sum: { pontos: true } }),
    tx.checklistConfig.findUnique({ where: { id: 1 }, select: { nivelPlatina: true, nivelLegend: true } }),
    tx.desempenhoBonus.findUnique({ where: { pessoaId_competencia: { pessoaId, competencia } } }),
    tx.presencaAjuste.findMany({ where: { pessoaId, instante: janela }, orderBy: { criadoEm: "desc" } }),
  ]);
  if (!pessoa) throw naoEncontrado("Pessoa");
  const programa = regra ? zPrograma.parse(regra.config) : PROGRAMA_INICIAL;
  const marcacoes = brutas.map(instanteEfetivo).map((m) => ({ id: m.id, pessoaId: m.pessoaId, tipo: m.tipo, instante: m.instante, instanteOriginal: m.instanteOriginal }));
  const presenca = apurarPresenca({ competencia, adesoes, marcacoes, justificativas, toleranciaMin: programa.toleranciaMin, pausaMaxMin: programa.pausaMaxMin, agora, fuso });
  const checklist = { total: itens.length, validados: itens.filter((i) => i.avaliacao === "VALIDADO").length };
  const diasElegiveis = new Set(presenca.dias.filter((d) => d.estado !== "FOLGA" && d.estado !== "FUTURO").map((d) => d.data));
  const diarias = avaliacoes.filter((a) => a.tipo === "DIARIA" && diasElegiveis.has(a.data));
  const lider = { media: diarias.length ? diarias.reduce((sum, a) => sum + mediaNotas(zNotas.parse(a.notas)), 0) / diarias.length : null, diasAvaliados: diarias.length };
  const clientes = pessoa.barbeiroId ? await resumoAvaliacaoBarbeiro(pessoa.barbeiroId, competencia) : { media: null, quantidade: 0, periodo: competencia };
  const totalPontos = pontos._sum.pontos ?? 0, nivel = nivelDoFuncionario(totalPontos, niveis ?? { nivelPlatina: 500, nivelLegend: 1500 });
  const resultado = elegibilidade({ programa, nivel, mesEncerrado: competencia < dataLocal(agora, fuso).slice(0, 7), adesao: adesoes.some((a) => a.aceitaEm !== null), presenca, checklist, lider, clientes, ajustesPendentes: ajustes.filter((a) => a.status === "PENDENTE").length });
  const hoje = dataLocal(agora, fuso), deHoje = marcacoes.filter((m) => dataLocal(m.instante, fuso) === hoje);
  return {
    pessoa, competencia, fuso, hoje, regraId: regra?.id ?? null, programa, adesoes, presenca, checklist, lider, clientes,
    pontos: totalPontos, nivel, marcacoes, ajustes, justificativas,
    avaliacoes: avaliacoes.map((a) => ({ id: a.id, data: a.data, tipo: a.tipo, notas: zNotas.parse(a.notas), comentario: a.comentario })),
    resultado: fechado ? memoriaBonus(fechado.snapshot)?.resultado ?? resultado : resultado,
    fechado: fechado ? { id: fechado.id, valorCentavos: fechado.valorCentavos, criadoEm: fechado.criadoEm, memoria: memoriaBonus(fechado.snapshot) } : null,
    proximasMarcacoes: proximasMarcacoes(deHoje.map((m) => m.tipo)),
  };
}

export async function painelDesempenho(s: Sessao, competencia?: string, pessoaId?: string) {
  const ctx = await contexto(s), comp = competencia ?? ctx.hoje.slice(0, 7);
  intervaloCompetencia(comp);
  const pessoas = await db.checklistPessoa.findMany({ where: ctx.avaliar ? {} : { usuarioId: s.usuarioId }, select: { id: true, nome: true, usuarioId: true, ativo: true }, orderBy: { nome: "asc" } });
  const selecionada = pessoaId ?? ctx.propriaId ?? pessoas[0]?.id;
  if (selecionada) await exigirPessoa(s, selecionada);
  const [resumo, regras, usuarios] = await Promise.all([
    selecionada ? resumoPessoa(selecionada, comp) : Promise.resolve(null),
    db.desempenhoRegra.findMany({ orderBy: { competenciaInicio: "desc" }, take: 24 }),
    ctx.dono ? db.usuario.findMany({ where: { ativo: true, papel: { not: "CLIENTE" } }, select: { id: true, nome: true }, orderBy: { nome: "asc" } }) : Promise.resolve([]),
  ]);
  return { contexto: { ...ctx, usuarioId: s.usuarioId }, competencia: comp, pessoas, resumo, regras: regras.map((r) => ({ id: r.id, competenciaInicio: r.competenciaInicio, config: zPrograma.parse(r.config) })), usuarios };
}

/** Apenas métricas agregadas; autorização para reuniões fica no chamador. */
export async function resumoDesempenhoBarbeiro(barbeiroId: string, competencia: string) {
  const pessoa = await db.checklistPessoa.findUnique({ where: { barbeiroId }, select: { id: true } });
  if (!pessoa) return null;
  const r = await resumoPessoa(pessoa.id, competencia);
  return { presenca: { previstos: r.presenca.previstos, cumpridos: r.presenca.cumpridos, pendentes: r.presenca.pendentes, percentual: r.presenca.percentual }, checklist: r.checklist, lider: r.lider, clientes: r.clientes, pontos: r.pontos, nivel: r.nivel };
}

export async function resumoDesempenhoPeriodo(barbeiroId: string, inicio: string, fim: string) {
  const pessoa = await db.checklistPessoa.findUnique({ where: { barbeiroId }, select: { id: true } });
  if (!pessoa) return null;
  const meses = new Set<string>();
  for (let d = inicio; d <= fim; d = somarDias(d, 1)) meses.add(d.slice(0, 7));
  const resumos = await Promise.all([...meses].map((m) => resumoPessoa(pessoa.id, m)));
  const dias = resumos.flatMap((r) => r.presenca.dias).filter((d) => d.data >= inicio && d.data <= fim && d.estado !== "FOLGA" && d.estado !== "FUTURO");
  const [itens, notas] = await Promise.all([
    db.checklistItem.findMany({ where: { pessoaId: pessoa.id, data: { gte: dataParaColuna(inicio), lte: dataParaColuna(fim) } }, select: { avaliacao: true } }),
    db.desempenhoAvaliacao.findMany({ where: { pessoaId: pessoa.id, tipo: "DIARIA", data: { gte: inicio, lte: fim } }, select: { notas: true } }),
  ]);
  const cumpridos = dias.filter((d) => d.estado === "CUMPRIU").length;
  return {
    presenca: { previstos: dias.length, cumpridos, pendentes: dias.filter((d) => d.estado === "PENDENTE").length, percentual: dias.length ? 100 * cumpridos / dias.length : null },
    checklist: { total: itens.length, validados: itens.filter((i) => i.avaliacao === "VALIDADO").length },
    lider: { media: notas.length ? notas.reduce((t, n) => t + mediaNotas(zNotas.parse(n.notas)), 0) / notas.length : null, diasAvaliados: notas.length },
  };
}
