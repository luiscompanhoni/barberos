/**
 * Configuracao do pote de assinaturas (% do faturamento de mensalidades dividido pelas fichas dos
 * atendimentos de plano) e das faixas de comissao de produtos. So o dono configura.
 */
import { auditar } from "@/lib/auditoria";
import type { Sessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { ErroNegocio } from "@/lib/erros";
import type { CategoriaComissao, ConfigPote, FaixaProduto } from "./regras";

const ID = "pote";

/** O que o calculo usa: pote (ligado ou nao) e faixas de produto. */
export async function regrasExtras(): Promise<{ pote: ConfigPote; faixas: FaixaProduto[] }> {
  const [cfg, fichas, ajustes, faixas] = await Promise.all([
    db.poteConfig.findUnique({ where: { id: ID } }),
    db.poteFicha.findMany(),
    db.poteBarbeiro.findMany(),
    db.comissaoProdutoFaixa.findMany({ orderBy: [{ categoria: "asc" }, { minimoCentavos: "asc" }] }),
  ]);
  return {
    pote: {
      ativo: cfg?.ativo ?? false,
      percentualBps: cfg?.percentualBps ?? 3500,
      fichas: Object.fromEntries(fichas.map((f) => [f.servicoId, f.fichas])),
      ajustes: Object.fromEntries(ajustes.map((a) => [a.barbeiroId, { adicionalBps: a.adicionalBps, diferenciadaBps: a.diferenciadaBps }])),
    },
    faixas: faixas.filter((f) => f.categoria !== "USO_INTERNO").map((f) => ({ categoria: f.categoria as CategoriaComissao, minimoCentavos: f.minimoCentavos, percentualBps: f.percentualBps })),
  };
}

/** Tela: todos os servicos e barbeiros ativos, com o que ja esta salvo. */
export async function configExtras() {
  const [{ pote, faixas }, servicos, barbeiros] = await Promise.all([
    regrasExtras(),
    db.servico.findMany({ where: { ativo: true }, orderBy: [{ ordem: "asc" }, { nome: "asc" }], select: { id: true, nome: true } }),
    db.barbeiro.findMany({ where: { ativo: true }, orderBy: [{ ordem: "asc" }, { nome: "asc" }], select: { id: true, nome: true } }),
  ]);
  return {
    pote: {
      ativo: pote.ativo,
      percentualBps: pote.percentualBps,
      fichas: servicos.map((s) => ({ servicoId: s.id, nome: s.nome, fichas: pote.fichas[s.id] ?? 0 })),
      ajustes: barbeiros.map((b) => ({ barbeiroId: b.id, nome: b.nome, adicionalBps: pote.ajustes[b.id]?.adicionalBps ?? 0, diferenciadaBps: pote.ajustes[b.id]?.diferenciadaBps ?? null })),
    },
    faixas,
  };
}

export type EntradaExtras = {
  pote: { ativo: boolean; percentualBps: number; fichas: { servicoId: string; fichas: number }[]; ajustes: { barbeiroId: string; adicionalBps: number; diferenciadaBps: number | null }[] };
  faixas: FaixaProduto[];
};

export async function salvarExtras(s: Sessao, d: EntradaExtras) {
  const pcts = [d.pote.percentualBps, ...d.pote.ajustes.flatMap((a) => [a.adicionalBps, a.diferenciadaBps ?? 0]), ...d.faixas.map((f) => f.percentualBps)];
  if (pcts.some((p) => p < 0 || p > 10000)) throw new ErroNegocio("Percentual tem que ficar entre 0% e 100%.");
  const chaves = new Set(d.faixas.map((f) => `${f.categoria}:${f.minimoCentavos}`));
  if (chaves.size !== d.faixas.length) throw new ErroNegocio("Tem duas faixas com o mesmo valor mínimo na mesma categoria.");
  if (d.pote.ativo && !d.pote.fichas.some((f) => f.fichas > 0)) throw new ErroNegocio("Para ligar o pote, dê fichas a pelo menos um serviço (ex.: corte 40, barba 20).");
  await db.$transaction(async (tx) => {
    await tx.poteConfig.upsert({ where: { id: ID }, create: { id: ID, ativo: d.pote.ativo, percentualBps: d.pote.percentualBps }, update: { ativo: d.pote.ativo, percentualBps: d.pote.percentualBps } });
    await tx.poteFicha.deleteMany({});
    const fichas = d.pote.fichas.filter((f) => f.fichas > 0);
    if (fichas.length) await tx.poteFicha.createMany({ data: fichas });
    await tx.poteBarbeiro.deleteMany({});
    const ajustes = d.pote.ajustes.filter((a) => a.adicionalBps || a.diferenciadaBps !== null);
    if (ajustes.length) await tx.poteBarbeiro.createMany({ data: ajustes });
    await tx.comissaoProdutoFaixa.deleteMany({});
    if (d.faixas.length) await tx.comissaoProdutoFaixa.createMany({ data: d.faixas });
    await auditar(tx, s.usuarioId, "rh_comissoes_extras", "comissao", "pote_produtos", {
      pote: { ativo: d.pote.ativo, percentualBps: d.pote.percentualBps, fichas: fichas.length, ajustes: ajustes.length }, faixas: d.faixas.length,
    });
  });
  return configExtras();
}
