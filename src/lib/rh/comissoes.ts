/**
 * Comissoes dos barbeiros: regra geral por servico (avulso e plano), excecao por barbeiro
 * e relatorio por periodo a partir dos agendamentos CONCLUIDO.
 */
import { configuracao } from "@/lib/agenda/carregar";
import { instanteLocal, somarDias } from "@/lib/agenda/tempo";
import { auditar } from "@/lib/auditoria";
import type { Sessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { ErroNegocio } from "@/lib/erros";
import { regrasExtras } from "./pote";
import { calcularPote, comissaoProdutos, REGRA_SUGERIDA, resumirComissoes, type CategoriaComissao, type Regra, type RegraSalva } from "./regras";

const soRegra = (r: Regra): Regra => ({ avulsoTipo: r.avulsoTipo, avulsoValor: r.avulsoValor, planoTipo: r.planoTipo, planoValor: r.planoValor });

/** Tela de configuracao: todos os servicos ativos (sem regra salva vem a sugestao) + excecoes. */
export async function configComissoes() {
  const [servicos, barbeiros, regras] = await Promise.all([
    db.servico.findMany({ where: { ativo: true }, orderBy: [{ ordem: "asc" }, { nome: "asc" }], select: { id: true, nome: true, precoCentavos: true } }),
    db.barbeiro.findMany({ where: { ativo: true }, orderBy: [{ ordem: "asc" }, { nome: "asc" }], select: { id: true, nome: true } }),
    db.comissaoServico.findMany(),
  ]);
  return {
    sugestao: REGRA_SUGERIDA,
    barbeiros,
    servicos: servicos.map((s) => {
      const g = regras.find((r) => r.servicoId === s.id && r.barbeiroId === null);
      return { ...s, salvo: !!g, ...soRegra(g ?? REGRA_SUGERIDA) };
    }),
    excecoes: regras.filter((r) => r.barbeiroId !== null).map((r) => ({ servicoId: r.servicoId, barbeiroId: r.barbeiroId!, ...soRegra(r) })),
  };
}

type Entrada = Regra & { servicoId: string };

function validar(r: Regra) {
  for (const [t, v] of [[r.avulsoTipo, r.avulsoValor], [r.planoTipo, r.planoValor]] as const) {
    if (t === "PERCENTUAL" && v > 10000) throw new ErroNegocio("A comissão percentual não pode passar de 100%.");
  }
}

/** Salva as regras gerais e substitui todas as excecoes. */
export async function salvarComissoes(s: Sessao, d: { gerais: Entrada[]; excecoes: (Entrada & { barbeiroId: string })[] }) {
  [...d.gerais, ...d.excecoes].forEach(validar);
  const chaves = new Set(d.excecoes.map((e) => `${e.servicoId}:${e.barbeiroId}`));
  if (chaves.size !== d.excecoes.length) throw new ErroNegocio("Tem exceção repetida para o mesmo barbeiro e serviço.");
  await db.$transaction(async (tx) => {
    for (const g of d.gerais) {
      // Unique com NULL nao impede duplicata no Postgres: procura e atualiza.
      const atual = await tx.comissaoServico.findMany({ where: { servicoId: g.servicoId, barbeiroId: null }, orderBy: { id: "asc" } });
      if (atual.length) {
        await tx.comissaoServico.update({ where: { id: atual[0].id }, data: soRegra(g) });
        if (atual.length > 1) await tx.comissaoServico.deleteMany({ where: { id: { in: atual.slice(1).map((a) => a.id) } } });
      } else {
        await tx.comissaoServico.create({ data: { servicoId: g.servicoId, barbeiroId: null, ...soRegra(g) } });
      }
    }
    await tx.comissaoServico.deleteMany({ where: { barbeiroId: { not: null } } });
    if (d.excecoes.length) await tx.comissaoServico.createMany({ data: d.excecoes.map((e) => ({ servicoId: e.servicoId, barbeiroId: e.barbeiroId, ...soRegra(e) })) });
    await auditar(tx, s.usuarioId, "rh_comissoes_configurar", "comissao", "servicos", { gerais: d.gerais.length, excecoes: d.excecoes.length });
  });
  return configComissoes();
}

/**
 * Relatorio de comissoes do periodo (datas locais "AAAA-MM-DD", inclusivas): servicos (avulso e plano),
 * pote de assinaturas (quando ligado, no lugar da regra "pelo plano") e produtos vendidos (por faixa).
 * O pote e calculado com todos os barbeiros (a fatia de um depende das fichas dos outros).
 */
export async function relatorioComissoes(inicio: string, fim: string, barbeiroId?: string) {
  if (fim < inicio) throw new ErroNegocio("A data final é antes da inicial.");
  const fuso = (await configuracao()).fuso;
  const janela = { gte: new Date(instanteLocal(inicio, 0, fuso)), lt: new Date(instanteLocal(somarDias(fim, 1), 0, fuso)) };
  const [ags, regras, barbeiros, extras, receita, itens] = await Promise.all([
    db.agendamento.findMany({
      where: { status: "CONCLUIDO", inicio: janela },
      orderBy: { inicio: "asc" },
      select: { id: true, inicio: true, barbeiroId: true, servicoId: true, precoCentavos: true, assinaturaId: true, cliente: { select: { nome: true } }, servico: { select: { nome: true, precoCentavos: true } } },
    }),
    db.comissaoServico.findMany() as Promise<RegraSalva[]>,
    db.barbeiro.findMany({ select: { id: true, nome: true } }),
    regrasExtras(),
    db.cobranca.aggregate({ where: { status: "PAGA", pagaEm: janela }, _sum: { valorCentavos: true } }),
    db.itemComanda.findMany({
      where: { produtoId: { not: null }, barbeiroId: { not: null }, comanda: { status: "FECHADA", fechadaEm: janela } },
      select: { barbeiroId: true, quantidade: true, precoUnitCentavos: true, produto: { select: { categoria: true } } },
    }),
  ]);
  const { pote, faixas } = extras;
  const grupos = resumirComissoes(ags.filter((a) => !barbeiroId || a.barbeiroId === barbeiroId).map((a) => ({
    id: a.id, barbeiroId: a.barbeiroId, servicoId: a.servicoId, preco: a.precoCentavos, precoTabela: a.servico.precoCentavos, plano: !!a.assinaturaId,
    inicio: a.inicio, cliente: a.cliente.nome, servico: a.servico.nome,
  })), regras, { planoPeloPote: pote.ativo });
  const potes = pote.ativo ? calcularPote(pote, receita._sum.valorCentavos ?? 0, ags.filter((a) => a.assinaturaId)) : null;
  const produtos = comissaoProdutos(itens.filter((i) => i.produto?.categoria === "BAR" || i.produto?.categoria === "LOJA").map((i) => ({
    barbeiroId: i.barbeiroId!, categoria: i.produto!.categoria as CategoriaComissao, valorCentavos: i.quantidade * i.precoUnitCentavos,
  })), faixas);

  const nomes = new Map(barbeiros.map((b) => [b.id, b.nome]));
  const ids = new Set([...grupos.map((g) => g.barbeiroId), ...(potes?.barbeiros.map((p) => p.barbeiroId) ?? []), ...produtos.keys()]);
  const vazio = { qtd: 0, base: 0, comissao: 0 };
  const linhas = [...ids].filter((id) => !barbeiroId || id === barbeiroId).map((id) => {
    const g = grupos.find((x) => x.barbeiroId === id);
    const p = potes?.barbeiros.find((x) => x.barbeiroId === id) ?? null;
    const pr = produtos.get(id) ?? null;
    return {
      barbeiroId: id, nome: nomes.get(id) ?? "?", avulso: g?.avulso ?? vazio, plano: g?.plano ?? vazio, pote: p, produtos: pr,
      total: (g?.total ?? 0) + (p?.comissao ?? 0) + (pr?.comissao ?? 0), semRegra: g?.semRegra ?? 0,
      atendimentos: (g?.detalhe ?? []).map((x) => ({ id: x.id, inicio: x.inicio, cliente: x.cliente, servico: x.servico, modalidade: x.modalidade, base: x.base, regra: x.regra, comissao: x.comissao })),
    };
  }).sort((a, b) => b.total - a.total);
  return {
    inicio, fim, barbeiros: linhas, total: linhas.reduce((t, l) => t + l.total, 0),
    pote: potes ? { receitaCentavos: potes.receitaCentavos, percentualBps: potes.percentualBps, valorPote: potes.valorPote, fichasTotal: potes.fichasTotal } : null,
  };
}
