/**
 * Configuracao da comissao das assinaturas (percentual base e Creditos de Atendimento por servico) e das
 * faixas de comissao de produtos. So o dono configura.
 */
import { auditar } from "@/lib/auditoria";
import type { Sessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { ErroNegocio } from "@/lib/erros";
import { listarAdicionais } from "./adicionais";
import type { CategoriaComissao, ConfigAssinaturas, FaixaProduto } from "./regras";

const ID = "pote";

/** O que o calculo usa: comissao das assinaturas (ligada ou nao) e faixas de produto. */
export async function regrasExtras(): Promise<{ assinaturas: ConfigAssinaturas; faixas: FaixaProduto[] }> {
  const [cfg, creditos, faixas] = await Promise.all([
    db.poteConfig.findUnique({ where: { id: ID } }),
    db.poteFicha.findMany(),
    db.comissaoProdutoFaixa.findMany({ orderBy: [{ categoria: "asc" }, { minimoCentavos: "asc" }] }),
  ]);
  return {
    assinaturas: {
      ativo: cfg?.ativo ?? false,
      percentualBps: cfg?.percentualBps ?? 3500,
      creditos: Object.fromEntries(creditos.map((f) => [f.servicoId, f.fichas])),
    },
    faixas: faixas.filter((f) => f.categoria !== "USO_INTERNO").map((f) => ({ categoria: f.categoria as CategoriaComissao, minimoCentavos: f.minimoCentavos, percentualBps: f.percentualBps })),
  };
}

/** Tela: servicos e barbeiros ativos, o que ja esta salvo e a comissao diferenciada de cada um. */
export async function configExtras() {
  const [{ assinaturas, faixas }, servicos, barbeiros, adicionais] = await Promise.all([
    regrasExtras(),
    db.servico.findMany({ where: { ativo: true }, orderBy: [{ ordem: "asc" }, { nome: "asc" }], select: { id: true, nome: true } }),
    db.barbeiro.findMany({ where: { ativo: true }, orderBy: [{ ordem: "asc" }, { nome: "asc" }], select: { id: true, nome: true } }),
    listarAdicionais(),
  ]);
  return {
    assinaturas: {
      ativo: assinaturas.ativo,
      percentualBps: assinaturas.percentualBps,
      creditos: servicos.map((s) => ({ servicoId: s.id, nome: s.nome, creditos: assinaturas.creditos[s.id] ?? 0 })),
    },
    faixas,
    barbeiros,
    ...adicionais,
  };
}

export type EntradaExtras = {
  assinaturas: { ativo: boolean; percentualBps: number; creditos: { servicoId: string; creditos: number }[] };
  faixas: FaixaProduto[];
};

export async function salvarExtras(s: Sessao, d: EntradaExtras) {
  const pcts = [d.assinaturas.percentualBps, ...d.faixas.map((f) => f.percentualBps)];
  if (pcts.some((p) => p < 0 || p > 10000)) throw new ErroNegocio("Percentual tem que ficar entre 0% e 100%.");
  const chaves = new Set(d.faixas.map((f) => `${f.categoria}:${f.minimoCentavos}`));
  if (chaves.size !== d.faixas.length) throw new ErroNegocio("Tem duas faixas com o mesmo valor mínimo na mesma categoria.");
  if (d.assinaturas.ativo && !d.assinaturas.creditos.some((f) => f.creditos > 0)) {
    throw new ErroNegocio("Para ligar a comissão das assinaturas, dê créditos a pelo menos um serviço (ex.: corte 40, barba 20).");
  }
  const antes = await regrasExtras();
  await db.$transaction(async (tx) => {
    await tx.poteConfig.upsert({
      where: { id: ID },
      create: { id: ID, ativo: d.assinaturas.ativo, percentualBps: d.assinaturas.percentualBps },
      update: { ativo: d.assinaturas.ativo, percentualBps: d.assinaturas.percentualBps },
    });
    await tx.poteFicha.deleteMany({});
    const creditos = d.assinaturas.creditos.filter((f) => f.creditos > 0);
    if (creditos.length) await tx.poteFicha.createMany({ data: creditos.map((c) => ({ servicoId: c.servicoId, fichas: c.creditos })) });
    await tx.comissaoProdutoFaixa.deleteMany({});
    if (d.faixas.length) await tx.comissaoProdutoFaixa.createMany({ data: d.faixas });
    await auditar(tx, s.usuarioId, "rh_comissoes_extras", "comissao", "assinaturas_produtos", {
      antes: { ativo: antes.assinaturas.ativo, percentualBps: antes.assinaturas.percentualBps, creditos: antes.assinaturas.creditos, faixas: antes.faixas },
      depois: { ativo: d.assinaturas.ativo, percentualBps: d.assinaturas.percentualBps, creditos: Object.fromEntries(creditos.map((c) => [c.servicoId, c.creditos])), faixas: d.faixas },
    });
  });
  return configExtras();
}
