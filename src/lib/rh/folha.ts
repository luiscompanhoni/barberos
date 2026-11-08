/**
 * Folha de pagamento por competencia (AAAA-MM): previa ao vivo, lancamentos (vale pode sair do
 * caixa como sangria), fechar (congela), marcar como paga (gera Despesa FOLHA) e reabrir.
 */
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { configuracao } from "@/lib/agenda/carregar";
import { dataLocal, dataParaColuna } from "@/lib/agenda/tempo";
import { auditar } from "@/lib/auditoria";
import type { Sessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import { movimentarCaixaNaTransacao } from "@/lib/financeiro/caixa";
import { relatorioComissoes } from "./comissoes";
import { csvFolha, intervaloCompetencia, totaisFolha, type TipoLancamento } from "./regras";
import { lerMemoriaFolha } from "./memoria-folha";
import { revisaoApuracao } from "./revisao";
import { lerVigenciaRemuneracao } from "./vigencias";
import { salarioVigente } from "./vigencia-regras";
import { tocarPessoasDaFolha } from "./trava-regras-folha";

export const FORMAS_PAGAMENTO = ["PIX", "TRANSFERENCIA", "DINHEIRO_CAIXA"] as const;
export type FormaPagamentoFolha = (typeof FORMAS_PAGAMENTO)[number];
type PendenciaVinculo = { barbeiroId: string; nome: string; comissaoCentavos: number; motivo: "SEM_VINCULO" | "INATIVO" | "AMBIGUO" };

const reaisTexto = (c: number) => `R$ ${(c / 100).toFixed(2).replace(".", ",")}`;

/** Previa por funcionario: congelada se a folha ja foi fechada, senao calculada agora. */
async function calcularPreviaFolha(comp: string, leitor: Prisma.TransactionClient) {
  const { inicio, fim } = intervaloCompetencia(comp);
  const [todasPessoas, lancs, todasFolhas, comissoes] = await Promise.all([
    leitor.checklistPessoa.findMany({
      orderBy: [{ nome: "asc" }],
      include: { barbeiro: { select: { nome: true } } },
    }),
    leitor.folhaLancamento.findMany({ where: { competencia: comp }, orderBy: [{ criadoEm: "asc" }, { id: "asc" }] }),
    leitor.folhaPagamento.findMany({ where: { competencia: comp } }),
    relatorioComissoes(inicio, fim, undefined, leitor),
  ]);
  const folhas = todasFolhas.filter(f => f.ativa !== false);
  const pessoas = todasPessoas.filter(p => p.ativo || lancs.some(l => l.pessoaId === p.id) || folhas.some(f => f.pessoaId === p.id));
  // A ficha de hoje não comprova a identidade de um retrato histórico.
  const historicas = folhas.map(f => ({ f, barbeiroId: f.barbeiroIdCongelado ?? lerMemoriaFolha(f.detalhe)?.barbeiroId ?? null }));
  const historiaSemIdentidade = historicas.some(h => !h.barbeiroId && h.f.comissaoCentavos !== 0);
  const pendenciasVinculos: PendenciaVinculo[] = comissoes.barbeiros.flatMap(com => {
    const atual = com.recalculoAtual;
    const temAtividade = atual.total !== 0 || atual.avulso.qtd > 0 || atual.plano.qtd > 0 || (atual.assinaturas?.qtd ?? 0) > 0 || !!atual.produtos;
    if (!temAtividade) return [];
    const retratos = historicas.filter(h => h.barbeiroId === com.barbeiroId);
    const fichas = todasPessoas.filter(p => p.barbeiroId === com.barbeiroId);
    const outroDestinatario = retratos.length === 1 && fichas.some(p => p.id !== retratos[0].f.pessoaId && pessoas.some(l => l.id === p.id) && !folhas.some(f => f.pessoaId === p.id));
    // O destinatário congelado permanece coberto mesmo após desvincular/inativar a ficha atual.
    if (retratos.length === 1 && !outroDestinatario) return [];
    let motivo: PendenciaVinculo["motivo"] | null = null;
    if (retratos.length > 1 || outroDestinatario || historiaSemIdentidade || fichas.length > 1 || fichas.some(p => folhas.some(f => f.pessoaId === p.id))) motivo = "AMBIGUO";
    else if (!fichas.length) motivo = "SEM_VINCULO";
    else if (!fichas[0].ativo) motivo = "INATIVO";
    return motivo ? [{ barbeiroId: com.barbeiroId, nome: com.nome, comissaoCentavos: atual.total, motivo }] : [];
  });
  const linhas = await Promise.all(pessoas.map(async (p) => {
    const ls = lancs.filter((l) => l.pessoaId === p.id);
    const com = p.barbeiroId ? comissoes.barbeiros.find((b) => b.barbeiroId === p.barbeiroId) : undefined;
    const salario = await lerVigenciaRemuneracao<{ salarioCentavos: number }>(leitor, `salario:${p.id}`, comp);
    const t = totaisFolha({ salario: salario ? salarioVigente(salario.conteudo) : p.salarioCentavos, comissao: com?.recalculoAtual.total ?? com?.total ?? 0, lancamentos: ls });
    const f = folhas.find((x) => x.pessoaId === p.id);
    const congelado = f ? { salario: f.salarioCentavos, comissao: f.comissaoCentavos, adicionais: f.adicionaisCentavos, descontos: f.descontosCentavos, liquido: f.liquidoCentavos } : null;
    const memoria = f ? lerMemoriaFolha(f.detalhe) : null;
    return {
      pessoaId: p.id, nome: memoria?.nome ?? p.nome, cargo: f ? memoria?.cargo ?? null : p.cargo, chavePix: null, barbeiroId: f ? f.barbeiroIdCongelado ?? memoria?.barbeiroId ?? null : p.barbeiroId, revisaoPix: p.revisaoPix, barbeiro: f ? memoria?.barbeiro ?? null : p.barbeiro?.nome ?? null, ativo: p.ativo,
      ...(congelado ?? t),
      recalculoAtual: t,
      status: (f?.status ?? "ABERTA") as "ABERTA" | "FECHADA" | "PAGA",
      folhaId: f?.id ?? null, versao: f?.versao ?? null,
      vinculoPendente: !f && ((p.funcao === "BARBEIRO" && !p.barbeiroId) || pendenciasVinculos.some(v => v.barbeiroId === p.barbeiroId)),
      pagoEm: f?.pagoEm ?? null, despesaId: f?.despesaId ?? null,
      // Diferenca entre o congelado e o calculado agora (ex.: atendimento concluido depois de fechar).
      mudouDepois: !!congelado && Object.keys(congelado).some(k => congelado[k as keyof typeof congelado] !== t[k as keyof typeof t]),
      memoriaDisponivel: !f || !!memoria,
      comissaoDetalhe: f ? memoria?.comissao ?? null : com ? {
        avulso: com.avulso, plano: com.plano, semRegra: com.semRegra,
        assinaturas: com.assinaturas ?? null,
        produtos: com.produtos ? { vendido: com.produtos.vendido, comissao: com.produtos.comissao } : null,
      } : null,
      lancamentos: f ? memoria?.lancamentos ?? [] : ls.map((l) => ({ id: l.id, tipo: l.tipo, valorCentavos: l.valorCentavos, descricao: l.descricao, doCaixa: !!l.movimentoCaixaId, criadoEm: l.criadoEm })),
    };
  }));
  const recebimentos = comissoes.recebimentos;
  const conciliacaoAssinaturas = comissoes.assinaturas?.conciliacao ?? null;
  const revisao = revisaoApuracao({ comp, linhas, recebimentos, comissoes: comissoes.revisao, pendenciasVinculos, conciliacaoAssinaturas });
  const historicoRetificado = todasFolhas.filter(f => f.ativa === false).map(f => ({ folhaId: f.id, pessoaId: f.pessoaId, versao: f.versao, statusOriginal: f.status, liquidoCentavos: f.liquidoCentavos, despesaId: f.despesaId, criadoEm: f.criadoEm }));
  return { competencia: comp, linhas, revisao, recebimentos, pendenciasVinculos, conciliacaoAssinaturas, historicoRetificado };
}

export async function previaFolha(comp: string, leitor?: Prisma.TransactionClient) {
  if (leitor) return calcularPreviaFolha(comp, leitor);
  return db.$transaction(tx => calcularPreviaFolha(comp, tx), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

async function pessoaComFolha(comp: string, pessoaId: string, tx: Prisma.TransactionClient) {
  const p = await tx.checklistPessoa.findUnique({ where: { id: pessoaId } });
  if (!p) throw naoEncontrado("Funcionário");
  const f = await tx.folhaPagamento.findFirst({ where: { competencia: comp, pessoaId, ativa: true } });
  return { p, f };
}

/** Adicional, bonus, vale ou desconto. Vale com `doCaixa` sai do caixa aberto como sangria. */
export async function lancar(s: Sessao, d: { competencia: string; pessoaId: string; tipo: TipoLancamento; valorCentavos: number; descricao: string; doCaixa?: boolean; idempotencia?: string }) {
  intervaloCompetencia(d.competencia);
  // Chamadas internas antigas ganham ID novo; o endpoint exige chave durável por clique.
  const id = z.uuid().parse(d.idempotencia ?? randomUUID());
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${`folha-lancamento:${id}`}))`;
    await tx.$queryRaw`SELECT 1 FROM checklist_pessoas WHERE id = ${d.pessoaId} FOR UPDATE`;
    const existente = await tx.folhaLancamento.findUnique({ where: { id } });
    if (existente) {
      if (existente.pessoaId !== d.pessoaId || existente.competencia !== d.competencia || existente.tipo !== d.tipo
        || existente.valorCentavos !== d.valorCentavos || existente.descricao !== d.descricao
        || !!existente.movimentoCaixaId !== !!d.doCaixa || existente.porId !== s.usuarioId) {
        throw new ErroNegocio("A chave deste lançamento já foi usada com outros dados. Atualize a folha antes de continuar.", 409, "lancamento_idempotencia");
      }
      return existente;
    }
    // Excluir um lançamento sem caixa não libera sua chave para repetir uma ação antiga.
    if (await tx.auditoria.findFirst({ where: { acao: "rh_lancamento", entidade: "folha_lancamento", entidadeId: id }, select: { id: true } })) {
      throw new ErroNegocio("Este lançamento já foi registrado e removido. Atualize a folha antes de lançar novamente.", 409, "lancamento_removido");
    }
    const p = await tx.checklistPessoa.findUnique({ where: { id: d.pessoaId } });
    if (!p) throw naoEncontrado("Funcionário");
    const f = await tx.folhaPagamento.findFirst({ where: { competencia: d.competencia, pessoaId: d.pessoaId, ativa: true } });
    if (f) throw new ErroNegocio("A folha desse funcionário já foi fechada neste mês. Reabra para lançar.", 409, "folha_fechada");
    if (d.doCaixa && d.tipo !== "VALE") throw new ErroNegocio("Só o vale pode sair do dinheiro do caixa.");
    await tocarPessoasDaFolha(tx, [d.pessoaId]);
    const mov = d.doCaixa ? await movimentarCaixaNaTransacao(tx, s, "SANGRIA", d.valorCentavos, `Vale ${p.nome}: ${d.descricao}`) : null;
    const l = await tx.folhaLancamento.create({
      data: { id, pessoaId: p.id, competencia: d.competencia, tipo: d.tipo, valorCentavos: d.valorCentavos, descricao: d.descricao, movimentoCaixaId: mov?.id ?? null, porId: s.usuarioId },
    });
    await auditar(tx, s.usuarioId, "rh_lancamento", "folha_lancamento", l.id, { pessoaId: p.id, competencia: d.competencia, tipo: d.tipo, valorCentavos: d.valorCentavos, doCaixa: !!mov });
    return l;
  });
}

export async function excluirLancamento(s: Sessao, id: string) {
  const referencia = await db.folhaLancamento.findUnique({ where: { id }, select: { pessoaId: true } });
  if (!referencia) throw naoEncontrado("Lançamento");
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM checklist_pessoas WHERE id = ${referencia.pessoaId} FOR UPDATE`;
    const l = await tx.folhaLancamento.findUnique({ where: { id } });
    if (!l) throw naoEncontrado("Lançamento");
    if (l.pessoaId !== referencia.pessoaId) throw new ErroNegocio("O destinatário do lançamento mudou. Atualize a folha.", 409, "lancamento_mudou");
    if (await tx.desempenhoBonus.findUnique({ where: { folhaLancamentoId: id }, select: { id: true } })) throw new ErroNegocio("Este lançamento pertence a um bônus de desempenho aprovado. Preserve o histórico e registre um ajuste separado.", 409, "bonus_vinculado");
    if (await tx.folhaPagamento.findFirst({ where: { competencia: l.competencia, pessoaId: l.pessoaId, ativa: true } })) throw new ErroNegocio("A folha desse funcionário já foi fechada. Reabra para mexer.", 409, "folha_fechada");
    if (l.movimentoCaixaId) throw new ErroNegocio("Esse vale saiu do caixa (sangria) e não pode ser apagado. Lance um adicional para compensar e, se o dinheiro voltou, registre um suprimento no caixa.", 409, "vale_do_caixa");
    await tocarPessoasDaFolha(tx, [l.pessoaId]);
    await tx.folhaLancamento.delete({ where: { id } });
    await auditar(tx, s.usuarioId, "rh_lancamento_excluir", "folha_lancamento", id, { pessoaId: l.pessoaId, tipo: l.tipo, valorCentavos: l.valorCentavos });
  });
}

/** Congela os valores de quem ainda nao foi fechado (so quem tem algo a receber ou lancamento). */
export async function fecharFolha(s: Sessao, comp: string, pessoaId?: string, revisao?: string) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${`folha-fechar:${comp}`}))`;
    if (pessoaId) await tx.$queryRaw`SELECT id FROM checklist_pessoas WHERE id = ${pessoaId} FOR UPDATE`;
    else await tx.$queryRaw`SELECT id FROM checklist_pessoas ORDER BY id FOR UPDATE`;
    const previa = await previaFolha(comp, tx);
    if (revisao && revisao !== previa.revisao) throw new ErroNegocio("A apuração mudou desde a prévia. Recarregue e confira os valores antes de fechar.", 409, "folha_mudou");
    const abertas = previa.linhas.filter((l) => l.status === "ABERTA" && (!pessoaId || l.pessoaId === pessoaId) && (l.salario || l.comissao || l.lancamentos.length));
    const cadeiraAmbigua = pessoaId && abertas.some(l => previa.pendenciasVinculos.some(v => v.barbeiroId === l.barbeiroId && v.motivo === "AMBIGUO"));
    if ((!pessoaId && previa.pendenciasVinculos.length) || abertas.some(l => l.vinculoPendente)) throw new ErroNegocio("Há produção ou ficha de barbeiro sem destinatário de comissão comprovado. Confira os vínculos e cadastros ativos antes de fechar; a folha não foi alterada.", 409, cadeiraAmbigua ? "cadeira_folha_duplicada" : "vinculo_comissao_pendente");
    if (!abertas.length) throw new ErroNegocio("Nada para fechar nesta competência.", 409, "nada_para_fechar");
    if (previa.conciliacaoAssinaturas?.pendente && (!pessoaId || abertas.some(l => !!l.comissaoDetalhe?.assinaturas))) throw new ErroNegocio("O rateio das assinaturas tem valores sem conciliação. Confira a distribuição antes de fechar; a folha não foi alterada.", 409, "rateio_pendente");
    if (!previa.recebimentos.completo && abertas.some(l => !!l.comissaoDetalhe?.assinaturas)) throw new ErroNegocio("Existem mensalidades sem valor/data de recebimento comprovados. Concilie antes de fechar comissões de assinaturas.", 409, "recebimento_pendente");
    if (abertas.some(l => (l.comissaoDetalhe?.semRegra ?? 0) > 0)) throw new ErroNegocio("Há atendimentos sem regra de comissão. Confira antes de fechar a folha.", 409, "comissao_sem_regra");
    const historicas = await tx.folhaPagamento.findMany({ where: { competencia: comp, ativa: true }, select: { pessoaId: true, barbeiroIdCongelado: true, comissaoCentavos: true } });
    const cadeiras = new Set<string>();
    for (const l of abertas) {
      if (!l.barbeiroId) continue;
      if (cadeiras.has(l.barbeiroId) || historicas.some(f => f.pessoaId !== l.pessoaId && (f.barbeiroIdCongelado === l.barbeiroId || (!f.barbeiroIdCongelado && f.comissaoCentavos > 0)))) throw new ErroNegocio("Esta cadeira já aparece em outra folha da competência, ou há uma identidade histórica sem comprovação. Confira os destinatários antes de fechar; nenhuma comissão foi duplicada.", 409, "cadeira_folha_duplicada");
      cadeiras.add(l.barbeiroId);
    }
    const ids = abertas.map((l) => l.pessoaId).sort();
    await tocarPessoasDaFolha(tx, ids);
    for (const l of abertas) {
      const anterior = await tx.folhaPagamento.findFirst({ where: { competencia: comp, pessoaId: l.pessoaId }, orderBy: { versao: "desc" }, select: { id: true, versao: true } });
      const detalhe = JSON.parse(JSON.stringify({ versao: 2, revisao: previa.revisao, nome: l.nome, cargo: l.cargo, barbeiro: l.barbeiro, barbeiroId: l.barbeiroId, comissao: l.comissaoDetalhe, lancamentos: l.lancamentos, conciliacaoAssinaturas: previa.conciliacaoAssinaturas })) as Prisma.InputJsonValue;
      await tx.folhaPagamento.create({
        data: {
          competencia: comp, pessoaId: l.pessoaId, versao: (anterior?.versao ?? 0) + 1, substituiId: anterior?.id ?? null, barbeiroIdCongelado: l.barbeiroId, salarioCentavos: l.salario, comissaoCentavos: l.comissao,
          adicionaisCentavos: l.adicionais, descontosCentavos: l.descontos, liquidoCentavos: l.liquido, detalhe, status: "FECHADA",
        },
      });
    }
    await auditar(tx, s.usuarioId, "rh_folha_fechar", "folha", comp, { revisao: previa.revisao, pessoas: abertas.length, liquido: abertas.reduce((t, l) => t + l.liquido, 0) });
    return abertas.length;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch((e: unknown) => {
    if (e instanceof Prisma.PrismaClientKnownRequestError && (["P2034", "P2002"].includes(e.code)
      || (e.code === "P2010" && ["40001", "40P01"].includes(String(e.meta?.code))))) throw new ErroNegocio("Houve outra alteração durante o fechamento. Recarregue a prévia e confira antes de tentar novamente.", 409, "folha_mudou");
    throw e;
  });
}

/** Marca a folha de uma pessoa como paga e cria a Despesa FOLHA (paga). */
export async function pagarFolha(s: Sessao, comp: string, pessoaId: string, forma: FormaPagamentoFolha = "PIX") {
  intervaloCompetencia(comp);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM checklist_pessoas WHERE id = ${pessoaId} FOR UPDATE`;
    const { p, f } = await pessoaComFolha(comp, pessoaId, tx);
    if (!f) throw new ErroNegocio("Feche a folha antes de marcar como paga.", 409, "nao_fechada");
    if (f.status === "PAGA") throw new ErroNegocio("Essa folha já está paga.", 409, "ja_paga");
    await tocarPessoasDaFolha(tx, [pessoaId]);
    const descricao = `Folha ${comp.slice(5)}/${comp.slice(0, 4)} - ${p.nome}`;
    const agora = new Date(), hoje = dataLocal(agora, (await configuracao(tx)).fuso);
    const ok = await tx.folhaPagamento.updateMany({ where: { id: f.id, status: "FECHADA" }, data: { status: "PAGA", pagoEm: agora } });
    if (!ok.count) throw new ErroNegocio("Essa folha já está paga.", 409, "ja_paga");
    const mov = forma === "DINHEIRO_CAIXA" && f.liquidoCentavos > 0
      ? await movimentarCaixaNaTransacao(tx, s, "SANGRIA", f.liquidoCentavos, `Folha ${comp.slice(5)}/${comp.slice(0, 4)}`) : null;
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
  intervaloCompetencia(comp);
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM checklist_pessoas WHERE id = ${pessoaId} FOR UPDATE`;
    const { f } = await pessoaComFolha(comp, pessoaId, tx);
    if (!f) throw new ErroNegocio("Essa folha não está fechada.", 409, "nao_fechada");
    if (f.status === "PAGA") throw new ErroNegocio("Folha paga não pode ser reaberta.", 409, "ja_paga");
    await tocarPessoasDaFolha(tx, [pessoaId]);
    const r = await tx.folhaPagamento.deleteMany({ where: { id: f.id, status: "FECHADA" } });
    if (!r.count) throw new ErroNegocio("Folha paga não pode ser reaberta.", 409, "ja_paga");
    await auditar(tx, s.usuarioId, "rh_folha_reabrir", "folha_pagamento", f.id, { competencia: comp, pessoaId, retratoAnterior: JSON.parse(JSON.stringify(f)) as Prisma.InputJsonValue });
  });
}

export async function exportarCsv(comp: string) {
  const { linhas, pendenciasVinculos, conciliacaoAssinaturas } = await previaFolha(comp);
  if (pendenciasVinculos.length || linhas.some(l => l.status === "ABERTA" && l.vinculoPendente && (l.salario || l.comissao || l.lancamentos.length))) throw new ErroNegocio("A folha tem vínculos de comissão pendentes. Confira os destinatários antes de exportar um total incompleto.", 409, "vinculo_comissao_pendente");
  if (conciliacaoAssinaturas?.pendente && linhas.some(l => l.status === "ABERTA" && (l.salario || l.comissao || l.lancamentos.length))) throw new ErroNegocio("O rateio das assinaturas está pendente. Confira a distribuição antes de exportar a folha.", 409, "rateio_pendente");
  const status = { ABERTA: "Prévia", FECHADA: "Fechada", PAGA: "Paga" } as const;
  return csvFolha(comp, linhas.filter((l) => l.status !== "ABERTA" || l.liquido || l.salario || l.lancamentos.length).map((l) => ({ ...l, status: status[l.status] })));
}
