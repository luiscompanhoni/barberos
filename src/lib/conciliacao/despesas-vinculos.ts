import { Prisma } from "@prisma/client";
import type { Sessao } from "@/lib/auth/sessao";
import { auditar } from "@/lib/auditoria";
import { db } from "@/lib/db";
import { ErroNegocio, naoEncontrado, proibido } from "@/lib/erros";
import { hashConferencia, hashParDespesa } from "./despesas-hash";
import { configuracao } from "@/lib/agenda/carregar";
import { dataLocal } from "@/lib/agenda/tempo";

type Movimento = { tipo: string; fonte: string; valorCentavos: number };
type Despesa = { status: string; valorCentavos: number; pagoEm: Date | null; formaPagamento: string | null };
export function parDespesaValido(m: Movimento, d: Despesa) {
  return ["STONE", "CELCASH"].includes(m.fonte) && m.tipo === "PAGAMENTO" && m.valorCentavos < 0 && d.status === "PAGA" && !!d.pagoEm && d.formaPagamento !== "DINHEIRO_CAIXA" && d.valorCentavos === -m.valorCentavos;
}
export function exigirDonoConciliacao(s: Sessao) { if (s.papel !== "DONO") throw proibido(); }

/** Mesma ordem para vínculo/anulação: movimento bancário → despesa. Não altera pagamento ou valores. */
async function travarPar(tx: Prisma.TransactionClient, movimentoId: string, despesaId: string) {
  await tx.$queryRaw`SELECT id FROM movimentos_externos WHERE id = ${movimentoId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM despesas WHERE id = ${despesaId} FOR UPDATE`;
}

export async function vincularDespesaExterna(s: Sessao, movimentoId: string, despesaId: string, motivo: string) {
  exigirDonoConciliacao(s);
  if (motivo.trim().length < 5) throw new ErroNegocio("Explique a evidência do vínculo em pelo menos 5 caracteres.");
  try {
    return await db.$transaction(async tx => {
      await travarPar(tx, movimentoId, despesaId);
      const [movimento, despesa] = await Promise.all([tx.movimentoExterno.findUnique({ where: { id: movimentoId } }), tx.despesa.findUnique({ where: { id: despesaId } })]);
      if (!movimento || !despesa) throw naoEncontrado("Movimento ou despesa");
      if (!parDespesaValido(movimento, despesa)) throw new ErroNegocio("Vincule um pagamento bancário negativo a uma despesa paga, fora do caixa, do mesmo valor. Revise status e valores.", 409, "despesa_divergente");
      const ativos = await tx.vinculoDespesaExterna.findMany({ where: { anuladoEm: null, OR: [{ movimentoId }, { despesaId }] } });
      if (ativos.length) {
        if (ativos.length === 1 && ativos[0].movimentoId === movimentoId && ativos[0].despesaId === despesaId) return ativos[0];
        throw new ErroNegocio("Movimento ou despesa já possui outro vínculo. Confira e anule o vínculo incorreto com justificativa.", 409, "despesa_ja_vinculada");
      }
      const vinculo = await tx.vinculoDespesaExterna.create({ data: { movimentoId, despesaId, criadoPorId: s.usuarioId } });
      await auditar(tx, s.usuarioId, "despesa_vincular_extrato", "vinculo_despesa_externa", vinculo.id, { movimentoId, despesaId, motivo: motivo.trim(), valorCentavos: despesa.valorCentavos, dataExtrato: movimento.data.toISOString(), pagoEm: despesa.pagoEm!.toISOString() });
      return vinculo;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new ErroNegocio("Um vínculo concorrente ocupou este registro. Recarregue a conciliação.", 409, "despesa_ja_vinculada");
    throw e;
  }
}

export async function anularVinculoDespesa(s: Sessao, id: string, motivo: string) {
  exigirDonoConciliacao(s);
  if (motivo.trim().length < 5) throw new ErroNegocio("Informe o motivo da anulação em pelo menos 5 caracteres.");
  return db.$transaction(async tx => {
    const referencia = await tx.vinculoDespesaExterna.findUnique({ where: { id } });
    if (!referencia) throw naoEncontrado("Vínculo");
    await travarPar(tx, referencia.movimentoId, referencia.despesaId);
    const atual = await tx.vinculoDespesaExterna.findUniqueOrThrow({ where: { id } });
    if (atual.anuladoEm) return atual;
    const anulado = await tx.vinculoDespesaExterna.update({ where: { id }, data: { anuladoEm: new Date(), anuladoPorId: s.usuarioId, motivoAnulacao: motivo.trim() } });
    await auditar(tx, s.usuarioId, "despesa_anular_vinculo", "vinculo_despesa_externa", id, { movimentoId: atual.movimentoId, despesaId: atual.despesaId, motivo: motivo.trim() });
    return anulado;
  });
}

/** Coincidência legítima não força vínculo falso: ambos os custos são preservados. */
export async function confirmarDespesasDistintas(s: Sessao, movimentoId: string, despesaId: string, motivo: string) {
  exigirDonoConciliacao(s);
  if (motivo.trim().length < 5) throw new ErroNegocio("Explique por que são pagamentos diferentes.");
  return db.$transaction(async tx => {
    await travarPar(tx, movimentoId, despesaId);
    const [movimento, despesa] = await Promise.all([tx.movimentoExterno.findUnique({ where: { id: movimentoId } }), tx.despesa.findUnique({ where: { id: despesaId } })]);
    if (!movimento || !despesa) throw naoEncontrado("Movimento ou despesa");
    if (!parDespesaValido(movimento, despesa)) throw new ErroNegocio("Os dados mudaram. Recarregue as coincidências antes de decidir.", 409, "despesa_divergente");
    if (await tx.vinculoDespesaExterna.findFirst({ where: { movimentoId, despesaId, anuladoEm: null } })) throw new ErroNegocio("Este par já está vinculado como o mesmo pagamento. Anule o vínculo antes de revisar.", 409, "despesa_ja_vinculada");
    const entidadeId = hashConferencia({ movimentoId, despesaId }), hashPar = hashParDespesa(movimento, despesa);
    const ultima = await tx.auditoria.findFirst({ where: { acao: "despesa_coincidencia_distinta", entidade: "coincidencia_despesa", entidadeId }, orderBy: [{ criadoEm: "desc" }, { id: "desc" }], select: { dados: true } });
    if (ultima?.dados && typeof ultima.dados === "object" && !Array.isArray(ultima.dados) && ultima.dados.hashPar === hashPar) return { registrado: true };
    const { fuso } = await configuracao(tx);
    await auditar(tx, s.usuarioId, "despesa_coincidencia_distinta", "coincidencia_despesa", entidadeId, { movimentoId, despesaId, hashPar, competencia: dataLocal(movimento.data, fuso).slice(0, 7), motivo: motivo.trim() });
    return { registrado: true };
  });
}
