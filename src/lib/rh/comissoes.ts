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
import { REGRA_SUGERIDA, resumirComissoes, type Regra, type RegraSalva } from "./regras";

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

/** Relatorio de comissoes do periodo (datas locais "AAAA-MM-DD", inclusivas). */
export async function relatorioComissoes(inicio: string, fim: string, barbeiroId?: string) {
  if (fim < inicio) throw new ErroNegocio("A data final é antes da inicial.");
  const fuso = (await configuracao()).fuso;
  const [ags, regras, barbeiros] = await Promise.all([
    db.agendamento.findMany({
      where: {
        status: "CONCLUIDO",
        inicio: { gte: new Date(instanteLocal(inicio, 0, fuso)), lt: new Date(instanteLocal(somarDias(fim, 1), 0, fuso)) },
        ...(barbeiroId ? { barbeiroId } : {}),
      },
      orderBy: { inicio: "asc" },
      select: { id: true, inicio: true, barbeiroId: true, servicoId: true, precoCentavos: true, assinaturaId: true, cliente: { select: { nome: true } }, servico: { select: { nome: true, precoCentavos: true } } },
    }),
    db.comissaoServico.findMany() as Promise<RegraSalva[]>,
    db.barbeiro.findMany({ select: { id: true, nome: true } }),
  ]);
  const grupos = resumirComissoes(ags.map((a) => ({
    id: a.id, barbeiroId: a.barbeiroId, servicoId: a.servicoId, preco: a.precoCentavos, precoTabela: a.servico.precoCentavos, plano: !!a.assinaturaId,
    inicio: a.inicio, cliente: a.cliente.nome, servico: a.servico.nome,
  })), regras);
  const nomes = new Map(barbeiros.map((b) => [b.id, b.nome]));
  const linhas = grupos.map((g) => ({
    barbeiroId: g.barbeiroId, nome: nomes.get(g.barbeiroId) ?? "?", avulso: g.avulso, plano: g.plano, total: g.total, semRegra: g.semRegra,
    atendimentos: g.detalhe.map((x) => ({ id: x.id, inicio: x.inicio, cliente: x.cliente, servico: x.servico, modalidade: x.modalidade, base: x.base, regra: x.regra, comissao: x.comissao })),
  })).sort((a, b) => b.total - a.total);
  return { inicio, fim, barbeiros: linhas, total: linhas.reduce((t, l) => t + l.total, 0) };
}
