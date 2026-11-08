/**
 * Configuracao da comissao das assinaturas (percentual base e Creditos de Atendimento por servico) e das
 * faixas de comissao de produtos. So o dono configura.
 */
import { auditar } from "@/lib/auditoria";
import type { Prisma } from "@prisma/client";
import type { Sessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { ErroNegocio } from "@/lib/erros";
import { listarAdicionais } from "./adicionais";
import type { CategoriaComissao, ConfigAssinaturas, FaixaProduto } from "./regras";
import { revisaoApuracao } from "./revisao";
import { competenciaSalario, competenciasRemuneracao, garantirBaselineRemuneracao, gravarVigenciaRemuneracao } from "./vigencias";
import { tocarPessoasDaFolha } from "./trava-regras-folha";
import { ARREDONDAMENTOS_POTE, type ArredondamentoPote } from "./rateio-assinaturas";

const ID = "pote";

/** O que o calculo usa: comissao das assinaturas (ligada ou nao) e faixas de produto. */
export async function regrasExtras(c: Prisma.TransactionClient = db): Promise<{ assinaturas: ConfigAssinaturas; faixas: FaixaProduto[] }> {
  const [cfg, creditos, faixas] = await Promise.all([
    c.poteConfig.findUnique({ where: { id: ID } }),
    c.poteFicha.findMany(),
    c.comissaoProdutoFaixa.findMany({ orderBy: [{ categoria: "asc" }, { minimoCentavos: "asc" }] }),
  ]);
  return {
    assinaturas: {
      ativo: cfg?.ativo ?? false,
      percentualBps: cfg?.percentualBps ?? 3500,
      arredondamento: cfg?.arredondamento ?? "LEGADO",
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
    revisao: revisaoApuracao({ assinaturas, faixas }),
    vigenciaPadrao: competenciasRemuneracao().proxima,
    assinaturas: {
      ativo: assinaturas.ativo,
      percentualBps: assinaturas.percentualBps,
      arredondamento: assinaturas.arredondamento ?? "LEGADO",
      creditos: servicos.map((s) => ({ servicoId: s.id, nome: s.nome, creditos: assinaturas.creditos[s.id] ?? 0 })),
    },
    faixas,
    barbeiros,
    ...adicionais,
  };
}

export type EntradaExtras = {
  revisao?: string; competencia?: string;
  assinaturas: { ativo: boolean; percentualBps: number; arredondamento?: ArredondamentoPote; creditos: { servicoId: string; creditos: number }[] };
  faixas: FaixaProduto[];
};

export async function salvarExtras(s: Sessao, d: EntradaExtras) {
  const arredondamento = d.assinaturas.arredondamento ?? "LEGADO";
  if (!ARREDONDAMENTOS_POTE.includes(arredondamento)) throw new ErroNegocio("Método de arredondamento inválido.");
  const pcts = [d.assinaturas.percentualBps, ...d.faixas.map((f) => f.percentualBps)];
  if (pcts.some((p) => p < 0 || p > 10000)) throw new ErroNegocio("Percentual tem que ficar entre 0% e 100%.");
  const chaves = new Set(d.faixas.map((f) => `${f.categoria}:${f.minimoCentavos}`));
  if (chaves.size !== d.faixas.length) throw new ErroNegocio("Tem duas faixas com o mesmo valor mínimo na mesma categoria.");
  if (d.assinaturas.ativo && !d.assinaturas.creditos.some((f) => f.creditos > 0)) {
    throw new ErroNegocio("Para ligar a comissão das assinaturas, dê créditos a pelo menos um serviço (ex.: corte 40, barba 20).");
  }
  const competencia = competenciaSalario(d.competencia);
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${`folha-fechar:${competencia}`}))`;
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext('rh:config:extras'))`;
    await tocarPessoasDaFolha(tx);
    const antes = await regrasExtras(tx);
    if (d.revisao && d.revisao !== revisaoApuracao(antes)) throw new ErroNegocio("A configuração foi alterada. Recarregue antes de salvar.", 409, "comissoes_mudaram");
    if (await tx.folhaPagamento.count({ where: { competencia } })) throw new ErroNegocio("Há folha fechada nesta competência. Escolha uma competência posterior.", 409, "folha_fechada");
    await garantirBaselineRemuneracao(tx, "extras", JSON.parse(JSON.stringify(antes)) as Prisma.InputJsonValue, s.usuarioId);
    await tx.poteConfig.upsert({
      where: { id: ID },
      create: { id: ID, ativo: d.assinaturas.ativo, percentualBps: d.assinaturas.percentualBps, arredondamento },
      update: { ativo: d.assinaturas.ativo, percentualBps: d.assinaturas.percentualBps, arredondamento },
    });
    await tx.poteFicha.deleteMany({});
    const creditos = d.assinaturas.creditos.filter((f) => f.creditos > 0);
    if (creditos.length) await tx.poteFicha.createMany({ data: creditos.map((c) => ({ servicoId: c.servicoId, fichas: c.creditos })) });
    await tx.comissaoProdutoFaixa.deleteMany({});
    if (d.faixas.length) await tx.comissaoProdutoFaixa.createMany({ data: d.faixas });
    await gravarVigenciaRemuneracao(tx, { escopo: "extras", competencia, conteudo: JSON.parse(JSON.stringify(await regrasExtras(tx))) as Prisma.InputJsonValue, atorId: s.usuarioId });
    await auditar(tx, s.usuarioId, "rh_comissoes_extras", "comissao", "assinaturas_produtos", {
      antes: { ativo: antes.assinaturas.ativo, percentualBps: antes.assinaturas.percentualBps, arredondamento: antes.assinaturas.arredondamento ?? "LEGADO", creditos: antes.assinaturas.creditos, faixas: antes.faixas },
      depois: { ativo: d.assinaturas.ativo, percentualBps: d.assinaturas.percentualBps, arredondamento, creditos: Object.fromEntries(creditos.map((c) => [c.servicoId, c.creditos])), faixas: d.faixas },
    });
  });
  return configExtras();
}
