/**
 * Infraestrutura interna, ainda não conectada a rotas, mensagens ou fichas.
 * Não recebe ou registra respostas, notas, comentários ou profissional.
 */
import { db } from "@/lib/db";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";

/** A competência inicial é o mês de vencimento da fatura; precisa de validação de produto antes da ativação. */
export function competenciaDaCobranca(vencimento: Date) {
  if (!Number.isFinite(+vencimento)) throw new ErroNegocio("A cobrança não tem vencimento válido.");
  return vencimento.toISOString().slice(0, 7);
}

/** Reserva de elegibilidade idempotente, sem gerar direito a prêmio ou publicar avaliação. */
export async function prepararElegibilidadeMensal(clienteId: string, cobrancaId: string) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`avaliacao-mensal:${clienteId}`}))`;
    await tx.$queryRaw`SELECT id FROM cobrancas WHERE id = ${cobrancaId} FOR UPDATE`;
    const cobranca = await tx.cobranca.findFirst({ where: { id: cobrancaId, assinatura: { clienteId, cliente: { excluidoEm: null } } }, select: { id: true, status: true, pagaEm: true, vencimento: true } });
    if (!cobranca) throw naoEncontrado("Cobrança");
    if (cobranca.status !== "PAGA" || !cobranca.pagaEm) throw new ErroNegocio("A mensalidade ainda não está paga.", 409, "mensalidade_nao_paga");
    const competencia = competenciaDaCobranca(cobranca.vencimento);
    const existente = await tx.avaliacaoMensalElegibilidade.findUnique({ where: { clienteId_competencia: { clienteId, competencia } } });
    if (existente) return { competencia, pulou: !!existente.pulouEm, repetida: true };
    await tx.avaliacaoMensalElegibilidade.create({ data: { clienteId, cobrancaId, competencia } });
    return { competencia, pulou: false, repetida: false };
  });
}

/** Pular é voluntário e não avalia nem cria, remove ou altera fichas. */
export async function pularAvaliacaoMensal(clienteId: string, competencia: string, agora = new Date()) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(competencia)) throw new ErroNegocio("Competência inválida.");
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`avaliacao-mensal:${clienteId}`}))`;
    const e = await tx.avaliacaoMensalElegibilidade.findUnique({ where: { clienteId_competencia: { clienteId, competencia } } });
    if (!e) throw naoEncontrado("Elegibilidade");
    await tx.$queryRaw`SELECT id FROM cobrancas WHERE id = ${e.cobrancaId} FOR UPDATE`;
    const cobranca = await tx.cobranca.findUniqueOrThrow({ where: { id: e.cobrancaId }, select: { status: true, pagaEm: true } });
    if (cobranca.status !== "PAGA" || !cobranca.pagaEm) throw new ErroNegocio("A mensalidade não está paga.", 409, "mensalidade_nao_paga");
    if (!e.pulouEm) await tx.avaliacaoMensalElegibilidade.update({ where: { id: e.id }, data: { pulouEm: agora } });
    return { competencia, pulou: true, repetida: !!e.pulouEm };
  });
}
