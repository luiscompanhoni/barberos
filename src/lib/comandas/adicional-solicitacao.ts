import type { Prisma } from "@prisma/client";
import { ErroNegocio } from "@/lib/erros";

type Pedido = { comandaId: string; servicoId: string; barbeiroId: string; usuarioId: string };

/** A trava antecede o ciclo do cliente. O recibo de auditoria persiste mesmo após remoção do item. */
export async function retomarSolicitacaoAdicional(tx: Prisma.TransactionClient, id: string, pedido: Pedido) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`adicional-solicitacao:${id}`}))`;
  const recibo = await tx.auditoria.findFirst({ where: { entidade: "solicitacao_adicional", entidadeId: id, acao: "criar_adicional" }, select: { usuarioId: true, dados: true } });
  if (!recibo) {
    if (await tx.agendamento.findUnique({ where: { id }, select: { id: true } })) throw new ErroNegocio("Identificador já utilizado. Recarregue a comanda e confira os lançamentos.", 409, "solicitacao_reutilizada");
    return null;
  }
  const dados = recibo.dados as Record<string, unknown> | null;
  if (recibo.usuarioId !== pedido.usuarioId || !dados || dados.comandaId !== pedido.comandaId || dados.servicoId !== pedido.servicoId || dados.barbeiroId !== pedido.barbeiroId) throw new ErroNegocio("Esta solicitação pertence a outra operação ou usuário. Confira a comanda antes de tentar novamente.", 409, "solicitacao_reutilizada");
  const ag = await tx.agendamento.findUnique({ where: { id }, include: { itemComanda: { select: { comandaId: true } } } });
  if (!ag || ag.itemComanda?.comandaId !== pedido.comandaId || ag.adicionalDeId !== dados.principalId || ag.clienteId !== dados.clienteId || ag.servicoId !== pedido.servicoId || ag.barbeiroId !== pedido.barbeiroId || ag.status === "CANCELADO") throw new ErroNegocio("A inclusão anterior foi removida, cancelada ou revisada. Confira os registros; a repetição não lançou outro serviço.", 409, "solicitacao_encerrada");
  return ag;
}
