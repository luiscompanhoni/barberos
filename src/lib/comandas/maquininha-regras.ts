import { ErroNegocio } from "@/lib/erros";
import type { PedidoPOS } from "@/lib/pagamentos/pagarme";
import { z } from "zod";

export const referenciaPOS = (numero: number, pagamentoId: string) => `cmd-${numero}-${pagamentoId}`.slice(0, 52);

/** Data autoritativa mais recente; ISO inválido não desloca silenciosamente o caixa. */
export function ultimoInstantePOS(instantes: (string | undefined)[]) {
  const validos = instantes.filter(v => z.iso.datetime({ offset: true }).safeParse(v).success)
    .map(v => new Date(v!)).filter(d => Number.isFinite(+d));
  return validos.sort((a, b) => +b - +a)[0];
}

/** Valor e moeda autoritativos; status do pedido aberto não comprova liquidação. */
export function conferirValoresPOS(pedido: PedidoPOS, valor: number) {
  if (!Number.isSafeInteger(valor) || valor <= 0 || pedido.currency !== "BRL" || pedido.amount !== valor) {
    throw new ErroNegocio("O valor ou a moeda da maquininha diverge da cobrança. Confira com a gerência.", 409, "maquininha_divergente");
  }
  const charges = pedido.charges ?? [];
  const ids = charges.map((c) => c.id);
  if (new Set(ids).size !== ids.length) throw new ErroNegocio("Cobranças repetidas no retorno da maquininha.", 409, "maquininha_divergente");
  const pagas = charges.filter((c) => c.status === "paid");
  for (const c of charges) {
    if (!c.id || c.currency !== "BRL" || !Number.isSafeInteger(c.amount) || !Number.isSafeInteger(c.paid_amount ?? 0)
      || (c.paid_amount ?? 0) < 0 || (c.paid_amount ?? 0) > c.amount! || c.amount! > valor
      || !Number.isSafeInteger(c.canceled_amount ?? 0) || (c.canceled_amount ?? 0) < 0 || (c.canceled_amount ?? 0) > (c.paid_amount ?? 0)) {
      throw new ErroNegocio("Valores de pagamento/estorno inconsistentes na maquininha.", 409, "maquininha_divergente");
    }
  }
  const recebido = charges.reduce((s, c) => s + (c.paid_amount ?? 0), 0);
  const liquidado = pagas.reduce((s, c) => s + (c.paid_amount ?? 0), 0);
  const estornado = charges.reduce((s, c) => s + (c.canceled_amount ?? 0), 0);
  if (recebido > valor || estornado > valor) throw new ErroNegocio("Valor recebido/estornado acima da cobrança. Confira a conciliação.", 409, "maquininha_divergente");
  // Ausência do paid_amount não comprova zero. Uma charge em andamento também impede liberar a reserva.
  const cancelavel = charges.every(c => ["canceled", "failed"].includes(c.status) && c.paid_amount === 0 && !(c.canceled_amount ?? 0));
  return { pago: liquidado === valor, cancelavel, recebido, estornado, charge: pagas[0] };
}
