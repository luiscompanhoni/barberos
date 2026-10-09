/**
 * Folha de pagamento por competencia (AAAA-MM): previa ao vivo, lancamentos (vale pode sair do
 * caixa como sangria), fechar (congela), marcar como paga (gera Despesa FOLHA) e reabrir.
 */
import type { Prisma } from "@prisma/client";
import { configuracao } from "@/lib/agenda/carregar";
import { dataLocal, dataParaColuna } from "@/lib/agenda/tempo";
import { auditar } from "@/lib/auditoria";
import type { Sessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import { movimentarCaixa } from "@/lib/financeiro/caixa";
import { relatorioComissoes } from "./comissoes";
import { csvFolha, intervaloCompetencia, totaisFolha, type TipoLancamento } from "./regras";

export const FORMAS_PAGAMENTO = ["PIX", "TRANSFERENCIA", "DINHEIRO_CAIXA"] as const;
export type FormaPagamentoFolha = (typeof FORMAS_PAGAMENTO)[number];

const reaisTexto = (c: number) => `R$ ${(c / 100).toFixed(2).replace(".", ",")}`;

/** Previa por funcionario: congelada se a folha ja foi fechada, senao calculada agora. */
export async function previaFolha(comp: string) {
  const { inicio, fim } = intervaloCompetencia(comp);
  const [pessoas, lancs, folhas, comissoes] = await Promise.all([
    db.checklistPessoa.findMany({
      where: { OR: [{ ativo: true }, { lancamentosFolha: { some: { competencia: comp } } }, { folhas: { some: { competencia: comp } } }] },
      orderBy: [{ nome: "asc" }],
      include: { barbeiro: { select: { nome: true } } },
    }),
    db.folhaLancamento.findMany({ where: { competencia: comp }, orderBy: { criadoEm: "asc" } }),
    db.folhaPagamento.findMany({ where: { competencia: comp } }),
    relatorioComissoes(inicio, fim),
  ]);
  const linhas = pessoas.map((p) => {
    const ls = lancs.filter((l) => l.pessoaId === p.id);
    const com = p.barbeiroId ? comissoes.barbeiros.find((b) => b.barbeiroId === p.barbeiroId) : undefined;
    const t = totaisFolha({ salario: p.salarioCentavos, comissao: com?.total ?? 0, lancamentos: ls });
    const f = folhas.find((x) => x.pessoaId === p.id);
    const congelado = f ? { salario: f.salarioCentavos, comissao: f.comissaoCentavos, adicionais: f.adicionaisCentavos, descontos: f.descontosCentavos, liquido: f.liquidoCentavos } : null;
    return {
      pessoaId: p.id, nome: p.nome, cargo: p.cargo, chavePix: p.chavePix, barbeiro: p.barbeiro?.nome ?? null, ativo: p.ativo,
      ...(congelado ?? t),
      status: (f?.status ?? "ABERTA") as "ABERTA" | "FECHADA" | "PAGA",
      pagoEm: f?.pagoEm ?? null, despesaId: f?.despesaId ?? null,
      // Diferenca entre o congelado e o calculado agora (ex.: atendimento concluido depois de fechar).
      mudouDepois: !!congelado && congelado.liquido !== t.liquido,
      comissaoDetalhe: com ? { avulso: com.avulso, plano: com.plano, semRegra: com.semRegra } : null,
      lancamentos: ls.map((l) => ({ id: l.id, tipo: l.tipo, valorCentavos: l.valorCentavos, descricao: l.descricao, doCaixa: !!l.movimentoCaixaId, criadoEm: l.criadoEm })),
    };
  });
  return { competencia: comp, linhas };
}

async function pessoaComFolha(comp: string, pessoaId: string) {
  const p = await db.checklistPessoa.findUnique({ where: { id: pessoaId } });
  if (!p) throw naoEncontrado("Funcionário");
  const f = await db.folhaPagamento.findUnique({ where: { competencia_pessoaId: { competencia: comp, pessoaId } } });
  return { p, f };
}

/** Adicional, bonus, vale ou desconto. Vale com `doCaixa` sai do caixa aberto como sangria. */
export async function lancar(s: Sessao, d: { competencia: string; pessoaId: string; tipo: TipoLancamento; valorCentavos: number; descricao: string; doCaixa?: boolean }) {
  intervaloCompetencia(d.competencia);
  const { p, f } = await pessoaComFolha(d.competencia, d.pessoaId);
  if (f) throw new ErroNegocio("A folha desse funcionário já foi fechada neste mês. Reabra para lançar.", 409, "folha_fechada");
  if (d.doCaixa && d.tipo !== "VALE") throw new ErroNegocio("Só o vale pode sair do dinheiro do caixa.");
  const mov = d.doCaixa ? await movimentarCaixa(s, "SANGRIA", d.valorCentavos, `Vale ${p.nome}: ${d.descricao}`) : null;
  return db.$transaction(async (tx) => {
    const l = await tx.folhaLancamento.create({
      data: { pessoaId: p.id, competencia: d.competencia, tipo: d.tipo, valorCentavos: d.valorCentavos, descricao: d.descricao, movimentoCaixaId: mov?.id ?? null, porId: s.usuarioId },
    });
    await auditar(tx, s.usuarioId, "rh_lancamento", "folha_lancamento", l.id, { pessoaId: p.id, competencia: d.competencia, tipo: d.tipo, valorCentavos: d.valorCentavos, doCaixa: !!mov });
    return l;
  });
}

export async function excluirLancamento(s: Sessao, id: string) {
  const l = await db.folhaLancamento.findUnique({ where: { id } });
  if (!l) throw naoEncontrado("Lançamento");
  const { f } = await pessoaComFolha(l.competencia, l.pessoaId);
  if (f) throw new ErroNegocio("A folha desse funcionário já foi fechada. Reabra para mexer.", 409, "folha_fechada");
  // O dinheiro ja saiu da gaveta: corrigir com suprimento no caixa e um lancamento novo.
  if (l.movimentoCaixaId) throw new ErroNegocio("Esse vale saiu do caixa (sangria) e não pode ser apagado. Lance um adicional para compensar e, se o dinheiro voltou, registre um suprimento no caixa.", 409, "vale_do_caixa");
  await db.$transaction(async (tx) => {
    await tx.folhaLancamento.delete({ where: { id } });
    await auditar(tx, s.usuarioId, "rh_lancamento_excluir", "folha_lancamento", id, { pessoaId: l.pessoaId, tipo: l.tipo, valorCentavos: l.valorCentavos });
  });
}

/** Congela os valores de quem ainda nao foi fechado (so quem tem algo a receber ou lancamento). */
export async function fecharFolha(s: Sessao, comp: string, pessoaId?: string) {
  const { linhas } = await previaFolha(comp);
  const abertas = linhas.filter((l) => l.status === "ABERTA" && (!pessoaId || l.pessoaId === pessoaId) && (l.salario || l.comissao || l.lancamentos.length));
  if (!abertas.length) throw new ErroNegocio("Nada para fechar nesta competência.", 409, "nada_para_fechar");
  await db.$transaction(async (tx) => {
    for (const l of abertas) {
      const detalhe = { cargo: l.cargo, barbeiro: l.barbeiro, comissao: l.comissaoDetalhe, lancamentos: l.lancamentos } as unknown as Prisma.InputJsonValue;
      await tx.folhaPagamento.create({
        data: {
          competencia: comp, pessoaId: l.pessoaId, salarioCentavos: l.salario, comissaoCentavos: l.comissao,
          adicionaisCentavos: l.adicionais, descontosCentavos: l.descontos, liquidoCentavos: l.liquido, detalhe, status: "FECHADA",
        },
      });
    }
    await auditar(tx, s.usuarioId, "rh_folha_fechar", "folha", comp, { pessoas: abertas.length, liquido: abertas.reduce((t, l) => t + l.liquido, 0) });
  });
  return abertas.length;
}

/** Marca a folha de uma pessoa como paga e cria a Despesa FOLHA (paga). */
export async function pagarFolha(s: Sessao, comp: string, pessoaId: string, forma: FormaPagamentoFolha = "PIX") {
  const { p, f } = await pessoaComFolha(comp, pessoaId);
  if (!f) throw new ErroNegocio("Feche a folha antes de marcar como paga.", 409, "nao_fechada");
  if (f.status === "PAGA") throw new ErroNegocio("Essa folha já está paga.", 409, "ja_paga");
  const descricao = `Folha ${comp.slice(5)}/${comp.slice(0, 4)} - ${p.nome}`;
  const mov = forma === "DINHEIRO_CAIXA" && f.liquidoCentavos > 0 ? await movimentarCaixa(s, "SANGRIA", f.liquidoCentavos, descricao) : null;
  const agora = new Date();
  const hoje = dataLocal(agora, (await configuracao()).fuso);
  return db.$transaction(async (tx) => {
    const ok = await tx.folhaPagamento.updateMany({ where: { id: f.id, status: "FECHADA" }, data: { status: "PAGA", pagoEm: agora } });
    if (!ok.count) throw new ErroNegocio("Essa folha já está paga.", 409, "ja_paga");
    let despesaId: string | null = null;
    if (f.liquidoCentavos > 0) {
      const d = await tx.despesa.create({
        data: {
          descricao, categoria: "FOLHA", valorCentavos: f.liquidoCentavos, vencimento: dataParaColuna(hoje), status: "PAGA", pagoEm: agora,
          formaPagamento: forma, fornecedor: p.nome, observacao: `Salário ${reaisTexto(f.salarioCentavos)} + comissão ${reaisTexto(f.comissaoCentavos)} + adicionais ${reaisTexto(f.adicionaisCentavos)} - descontos ${reaisTexto(f.descontosCentavos)}`,
          movimentoCaixaId: mov?.id ?? null, criadoPorId: s.usuarioId,
        },
      });
      despesaId = d.id;
      await tx.folhaPagamento.update({ where: { id: f.id }, data: { despesaId } });
    }
    await auditar(tx, s.usuarioId, "rh_folha_paga", "folha_pagamento", f.id, { competencia: comp, pessoaId, liquido: f.liquidoCentavos, forma, despesaId });
    return { despesaId };
  });
}

/** Reabre (apaga o congelado) se ainda nao foi paga. */
export async function reabrirFolha(s: Sessao, comp: string, pessoaId: string) {
  const { f } = await pessoaComFolha(comp, pessoaId);
  if (!f) throw new ErroNegocio("Essa folha não está fechada.", 409, "nao_fechada");
  if (f.status === "PAGA") throw new ErroNegocio("Folha paga não pode ser reaberta.", 409, "ja_paga");
  await db.$transaction(async (tx) => {
    const r = await tx.folhaPagamento.deleteMany({ where: { id: f.id, status: "FECHADA" } });
    if (!r.count) throw new ErroNegocio("Folha paga não pode ser reaberta.", 409, "ja_paga");
    await auditar(tx, s.usuarioId, "rh_folha_reabrir", "folha_pagamento", f.id, { competencia: comp, pessoaId });
  });
}

export async function exportarCsv(comp: string) {
  const { linhas } = await previaFolha(comp);
  const status = { ABERTA: "Prévia", FECHADA: "Fechada", PAGA: "Paga" } as const;
  return csvFolha(comp, linhas.filter((l) => l.status !== "ABERTA" || l.liquido || l.salario || l.lancamentos.length).map((l) => ({ ...l, status: status[l.status] })));
}
