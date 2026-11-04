import { db } from "@/lib/db";
import { auditar } from "@/lib/auditoria";
import { ehHomologacao } from "@/lib/ambiente";
import { buscarPedido } from "@/lib/pagamentos/pagarme";
import { sincronizarLink } from "./sincronizacao";
import { travarLink } from "./transacao";

/** O webhook só fornece o id; identidade, referência, moeda e valor vêm do GET autoritativo. */
export async function recuperarPedidoLink(pedidoId: string) {
  if (ehHomologacao() || !/^or_[A-Za-z0-9_-]{1,100}$/.test(pedidoId) || !process.env.PAGARME_SECRET_KEY) return false;
  try {
    const pedido = await buscarPedido(pedidoId);
    const referencia = pedido.metadata?.referencia;
    if (pedido.id !== pedidoId || !referencia || !referencia.startsWith("lk-") || pedido.code !== referencia) return false;
    const l = await db.linkPagamento.findUnique({ where: { tentativaChave: referencia } });
    if (!l || pedido.currency !== "BRL" || pedido.amount !== l.valorCentavos || !Number.isSafeInteger(pedido.amount)) return false;
    const vinculado = await db.$transaction(async (tx) => {
      const atual = await travarLink(tx, l.id);
      if (atual.status !== "PENDENTE" || atual.tentativaChave !== referencia || pedido.amount !== atual.valorCentavos || (atual.gatewayId && atual.gatewayId !== pedidoId)) return false;
      if (!atual.gatewayId) {
        await tx.linkPagamento.update({ where: { id: atual.id }, data: { gatewayId: pedidoId } });
        await auditar(tx, null, "recuperar_tentativa_link", "link_pagamento", atual.id, { tentativaChave: referencia, gatewayId: pedidoId });
      }
      return true;
    });
    if (vinculado) await sincronizarLink(l.id);
    return vinculado;
  } catch {
    // Ausência de resposta não permite remover a intenção ou aceitar outro pedido.
    return false;
  }
}
