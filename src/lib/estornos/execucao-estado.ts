import type { PedidoEstorno, Prisma } from "@prisma/client";
import { auditar } from "@/lib/auditoria";
import { ErroNegocio, proibido } from "@/lib/erros";
import type { Alvo } from "./alvo";
import { STATUS_EFETIVOS } from "./regras";

type Tx = Prisma.TransactionClient;

export async function travarEstorno(tx: Tx, p: PedidoEstorno, alvo: Alvo) {
  if (alvo.comandaId) await tx.$queryRaw`SELECT 1 FROM comandas WHERE id = ${alvo.comandaId} FOR UPDATE`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`estorno:${p.tipo}:${p.referenciaId}`}))`;
}

/** Releitura sob a mesma trava usada por solicitações e pelo ledger, sem truncar excesso. */
export async function validarSaldoEstorno(tx: Tx, p: PedidoEstorno, alvo: Alvo) {
  const efetivos = await tx.pedidoEstorno.aggregate({
    where: { tipo: p.tipo, referenciaId: p.referenciaId, status: { in: STATUS_EFETIVOS }, id: { not: p.id } }, _sum: { valorCentavos: true },
  });
  const pg = alvo.pagamentoComandaId ? await tx.pagamentoComanda.findUniqueOrThrow({ where: { id: alvo.pagamentoComandaId } }) : null;
  const ja = Math.max(efetivos._sum.valorCentavos ?? 0, pg?.estornadoCentavos ?? 0);
  if (p.valorOriginalCentavos !== alvo.valorOriginal || p.valorCentavos > alvo.valorOriginal - ja) {
    throw new ErroNegocio("Há uma devolução já conciliada. Confira o saldo antes de confirmar outro estorno.", 409, "estorno_conciliado");
  }
}

export async function conferirComprovante(tx: Tx, usuarioId: string, p: PedidoEstorno, referencia: string) {
  const u = await tx.usuario.findUnique({ where: { id: usuarioId }, select: { ativo: true, papel: true } });
  if (!u?.ativo || u.papel !== "DONO") throw proibido();
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`estorno:comprovante:${referencia}`}))`;
  const repetido = await tx.pedidoEstorno.findFirst({ where: { id: { not: p.id }, status: { in: STATUS_EFETIVOS },
    OR: [{ instrucao: referencia }, { gatewayEstornoId: referencia }] }, select: { id: true } });
  if (repetido) throw new ErroNegocio("Esse comprovante já foi usado em outro estorno. Confira a devolução.", 409, "comprovante_repetido");
}

/** Invariante: APROVADO com instrução não nula já tem intenção reservada; nunca reenvia. */
export async function reservarExecucao(tx: Tx, p: PedidoEstorno, usuarioId: string, instrucao: string) {
  const r = await tx.pedidoEstorno.updateMany({ where: { id: p.id, status: "APROVADO", instrucao: null }, data: { instrucao, erro: null } });
  if (r.count) await auditar(tx, usuarioId, "estorno_execucao_reservada", "estorno", p.id, { meio: p.meio, valorCentavos: p.valorCentavos });
  return r.count > 0;
}
