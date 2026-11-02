import type { Prisma } from "@prisma/client";
import { auditar } from "@/lib/auditoria";
import type { CobrancaGateway } from "@/lib/pagamentos/gateway";

/** Chamado sob a trava da transação. Preserva o histórico e sinaliza alterações posteriores da fonte. */
export async function conferirVinculoSincronizado(tx: Prisma.TransactionClient, transacaoId: string, cob: CobrancaGateway) {
  const vinculo = await tx.vinculoCobrancaExterna.findUnique({ where: { fonte_transacaoId: { fonte: "CELCASH", transacaoId } }, include: { cobranca: { select: { status: true, valorCentavos: true } } } });
  if (!vinculo) return false;
  if (vinculo.cobranca.status === cob.status && vinculo.cobranca.valorCentavos === cob.valorCentavos) return true;
  const evidencia = vinculo.evidencia as Prisma.JsonObject;
  const anterior = evidencia.divergenciaGateway as Prisma.JsonObject | undefined;
  if (anterior?.status === cob.status && anterior?.valorCentavos === cob.valorCentavos) return true;
  const divergenciaGateway = { pendente: true, status: cob.status, valorCentavos: cob.valorCentavos, observadaEm: new Date().toISOString() };
  await tx.vinculoCobrancaExterna.update({ where: { id: vinculo.id }, data: { evidencia: { ...evidencia, divergenciaGateway } as Prisma.InputJsonObject } });
  await auditar(tx, null, "conciliacao_historico_divergencia", "cobranca", vinculo.cobrancaId, {
    transacaoId, vinculoId: vinculo.id, registrado: vinculo.cobranca, observado: divergenciaGateway,
  });
  return true;
}
