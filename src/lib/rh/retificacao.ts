import { Prisma } from "@prisma/client";
import type { Sessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { auditar } from "@/lib/auditoria";
import { ErroNegocio, naoEncontrado, proibido } from "@/lib/erros";
import { previaFolha } from "./folha";
import { revisaoApuracao } from "./revisao";
import { competenciasRemuneracao, garantirBaselineRemuneracao, gravarVigenciaRemuneracao } from "./vigencias";
import { tocarPessoasDaFolha } from "./trava-regras-folha";
import { impedimentosTeste, zRetificacaoTeste, zSalarioSubstitutivo, type RetificacaoTesteEntrada } from "./retificacao-regras";

type Tx = Prisma.TransactionClient;
async function donoAtual(tx: Tx, s: Sessao) {
  if (s.papel !== "DONO") throw proibido();
  const u = await tx.usuario.findUnique({ where: { id: s.usuarioId }, select: { papel: true, ativo: true, sessaoVersao: true } });
  if (!u?.ativo || u.papel !== "DONO" || u.sessaoVersao !== (s.sessaoVersao ?? 0)) throw proibido();
}
async function contexto(tx: Tx, folhaId: string, salarioSubstitutivoCentavos: number) {
  const f = await tx.folhaPagamento.findUnique({ where: { id: folhaId } });
  if (!f) throw naoEncontrado("Folha original");
  const [p, despesa, auditoria, vinculos, lotes, previa, retificacao] = await Promise.all([
    tx.checklistPessoa.findUnique({ where: { id: f.pessoaId }, select: { id: true, nome: true, ativo: true, funcao: true, cargo: true, barbeiroId: true, salarioCentavos: true } }),
    f.despesaId ? tx.despesa.findUnique({ where: { id: f.despesaId } }) : null,
    tx.auditoria.findFirst({ where: { acao: "rh_folha_paga", entidade: "folha_pagamento", entidadeId: f.id }, orderBy: { criadoEm: "asc" }, select: { id: true, dados: true, criadoEm: true } }),
    f.despesaId ? tx.vinculoDespesaExterna.count({ where: { despesaId: f.despesaId } }) : 0,
    tx.folhaLotePix.findMany({ where: { competencia: f.competencia }, orderBy: { id: "asc" } }),
    previaFolha(f.competencia, tx),
    tx.folhaRetificacaoTeste.findUnique({ where: { folhaOriginalId: f.id } }),
  ]);
  if (!p) throw naoEncontrado("Funcionário");
  const dadosAudit = auditoria?.dados;
  const manual = !!dadosAudit && typeof dadosAudit === "object" && !Array.isArray(dadosAudit)
    && dadosAudit.forma === "PIX" && dadosAudit.despesaId === f.despesaId && dadosAudit.liquido === 100;
  const problemas = impedimentosTeste(f, despesa, manual, vinculos, lotes);
  if (!p.ativo) problemas.push("A ficha do funcionário está inativa. Confira o cadastro antes de preparar uma folha substitutiva.");
  if (f.competencia !== competenciasRemuneracao().atual) problemas.push("Este fluxo é restrito ao teste da competência atual; meses anteriores exigem revisão histórica específica.");
  if (retificacao) problemas.push("O original já possui retificação. Consulte o histórico; não registre novamente.");
  const linha = previa.linhas.find(l => l.pessoaId === f.pessoaId);
  if (!linha) throw new ErroNegocio("A pessoa não consta da prévia. Confira o vínculo antes de retificar.", 409, "retificacao_sem_previa");
  const atual = linha.recalculoAtual;
  const substitutiva = { ...atual, salario: salarioSubstitutivoCentavos, liquido: salarioSubstitutivoCentavos + atual.comissao + atual.adicionais - atual.descontos };
  const revisao = revisaoApuracao({ folha: f, pessoa: p, despesa, auditoria, vinculos, lotes, revisaoFolha: previa.revisao, salarioSubstitutivoCentavos });
  return { f, p, despesa, lotes, problemas, revisao, substitutiva, retificacao,
    propostaPendente: linha.vinculoPendente || !!previa.conciliacaoAssinaturas?.pendente || !previa.recebimentos.completo || (linha.comissaoDetalhe?.semRegra ?? 0) > 0 };
}
const apresentar = (c: Awaited<ReturnType<typeof contexto>>) => ({
  revisao: c.revisao, podeRetificar: c.problemas.length === 0, impedimentos: c.problemas,
  folhaOriginal: { id: c.f.id, pessoaId: c.p.id, nome: c.p.nome, competencia: c.f.competencia, versao: c.f.versao, status: c.f.status, ativa: c.f.ativa, liquidoCentavos: c.f.liquidoCentavos, despesaId: c.f.despesaId, pagoEm: c.f.pagoEm },
  substitutiva: c.substitutiva, propostaPendente: c.propostaPendente,
  aviso: "Retificação interna sem transferência: o original e a despesa serão preservados. A nova folha ficará aberta para conferência; nenhum R$ 1,00 será descontado.",
  retificacao: c.retificacao ? { id: c.retificacao.id, criadoEm: c.retificacao.criadoEm, motivo: c.retificacao.motivo } : null,
});

export async function previaRetificacaoTeste(s: Sessao, folhaId: string, salario: number) {
  if (s.papel !== "DONO") throw proibido();
  zSalarioSubstitutivo.parse(salario);
  return db.$transaction(async tx => { await donoAtual(tx, s); return apresentar(await contexto(tx, folhaId, salario)); }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 });
}

/** Retifica somente o teste interno. Não integra banco, não estorna Pix e não fecha/paga substituta. */
export async function retificarTesteFolha(s: Sessao, entrada: RetificacaoTesteEntrada) {
  if (s.papel !== "DONO") throw proibido();
  const d = zRetificacaoTeste.parse(entrada);
  const referencia = await db.folhaPagamento.findUnique({ where: { id: d.folhaId }, select: { competencia: true, pessoaId: true } });
  if (!referencia) throw naoEncontrado("Folha original");
  const hashPedido = revisaoApuracao({ ...d, atorId: s.usuarioId });
  try {
    return await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${`folha-retificar:${d.idempotencia}`}))`;
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${`folha-fechar:${referencia.competencia}`}))`;
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${`folha-pix:${referencia.competencia}`}))`;
      await tx.$queryRaw`SELECT id FROM checklist_pessoas WHERE id = ${referencia.pessoaId} FOR UPDATE`;
      await donoAtual(tx, s);
      const repetida = await tx.folhaRetificacaoTeste.findUnique({ where: { idempotencia: d.idempotencia } });
      if (repetida) {
        if (repetida.hashPedido !== hashPedido || repetida.atorId !== s.usuarioId) throw new ErroNegocio("Esta chave de retificação já foi usada com outros dados.", 409, "retificacao_idempotencia");
        return { retificacaoId: repetida.id, competencia: referencia.competencia, jaRegistrada: true, substitutivaFechada: false as const };
      }
      const original = await tx.folhaPagamento.findUniqueOrThrow({ where: { id: d.folhaId }, select: { despesaId: true } });
      if (original.despesaId) await tx.$queryRaw`SELECT id FROM despesas WHERE id = ${original.despesaId} FOR UPDATE`;
      const c = await contexto(tx, d.folhaId, d.salarioSubstitutivoCentavos);
      if (c.retificacao) throw new ErroNegocio("Esta folha já foi retificada. Consulte o histórico.", 409, "folha_ja_retificada");
      if (c.revisao !== d.revisao) throw new ErroNegocio("A folha, a despesa ou o cadastro mudou. Atualize a prévia antes de confirmar.", 409, "retificacao_mudou");
      if (c.problemas.length || !c.despesa) throw new ErroNegocio(c.problemas.join(" "), 409, "retificacao_bloqueada");
      const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
      const evento = await tx.folhaRetificacaoTeste.create({ data: {
        idempotencia: d.idempotencia, folhaOriginalId: c.f.id, despesaOriginalId: c.despesa.id,
        atorId: s.usuarioId, atorSessaoVersao: s.sessaoVersao ?? 0, motivo: d.motivo, declaracao: d.declaracao,
        revisaoOrigem: d.revisao, hashPedido, salarioSubstitutivoCentavos: d.salarioSubstitutivoCentavos,
        snapshotFolha: json(c.f), snapshotDespesa: json(c.despesa),
      } });
      const desativada = await tx.folhaPagamento.updateMany({ where: { id: c.f.id, ativa: true, status: "PAGA" }, data: { ativa: false } });
      const anulada = await tx.despesa.updateMany({ where: { id: c.despesa.id, status: "PAGA" }, data: { status: "ANULADA_TESTE" } });
      if (desativada.count !== 1 || anulada.count !== 1) throw new ErroNegocio("O original mudou durante a retificação. Nada foi aplicado.", 409, "retificacao_mudou");
      const escopo = `salario:${c.p.id}`;
      await garantirBaselineRemuneracao(tx, escopo, { salarioCentavos: c.p.salarioCentavos }, s.usuarioId);
      await gravarVigenciaRemuneracao(tx, { escopo, competencia: c.f.competencia, conteudo: { salarioCentavos: d.salarioSubstitutivoCentavos }, atorId: s.usuarioId });
      const futura = await tx.remuneracaoVersao.findFirst({ where: { escopo, competencia: { gt: c.f.competencia } }, select: { id: true } });
      if (!futura) await tx.checklistPessoa.update({ where: { id: c.p.id }, data: { salarioCentavos: d.salarioSubstitutivoCentavos } });
      for (const lote of c.lotes) if (lote.estado !== "INVALIDADO") await tx.folhaLotePix.update({ where: { id: lote.id }, data: { estado: "INVALIDADO", invalidadoEm: new Date(), motivoInvalidacao: `Retificação interna de teste ${evento.id}; confira a nova prévia.` } });
      await tocarPessoasDaFolha(tx, [c.p.id]);
      await auditar(tx, s.usuarioId, "rh_folha_retificar_teste", "folha_retificacao_teste", evento.id, {
        folhaOriginalId: c.f.id, despesaOriginalId: c.despesa.id, competencia: c.f.competencia, pessoaId: c.p.id,
        valorAnuladoCentavos: 100, salarioSubstitutivoCentavos: d.salarioSubstitutivoCentavos,
        declaracao: d.declaracao, motivo: d.motivo, revisaoOrigem: d.revisao, lotesInvalidados: c.lotes.filter(l => l.estado !== "INVALIDADO").length,
        transferenciaExecutada: false, substitutivaFechada: false, rascunhoFuturoPreservado: !!futura,
      });
      return { retificacaoId: evento.id, competencia: c.f.competencia, jaRegistrada: false, substitutivaFechada: false as const };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && (["P2034", "P2002"].includes(e.code) || (e.code === "P2010" && ["40001", "40P01"].includes(String(e.meta?.code))))) throw new ErroNegocio("Houve outra alteração na retificação. Recarregue e confira o histórico antes de tentar novamente.", 409, "retificacao_mudou");
    throw e;
  }
}
