/**
 * Consultas dos estornos para o financeiro (caixa, extrato, conciliacao e resumo).
 * O recebimento original continua contando na data dele; o estorno desconta na data em que foi feito.
 */
import { db } from "@/lib/db";
import { STATUS_EFETIVOS } from "./regras";

/** Estornos devolvidos (pelo sistema ou por fora) numa janela de tempo. */
export function estornosEfetivos(janela: { gte: Date; lt?: Date; lte?: Date }) {
  return db.pedidoEstorno.findMany({
    where: { status: { in: STATUS_EFETIVOS }, executadoEm: janela },
    orderBy: { executadoEm: "asc" },
    select: { id: true, tipo: true, forma: true, meio: true, valorCentavos: true, executadoEm: true, descricao: true, clienteNome: true, movimentoCaixaId: true, motivo: true },
  });
}

/** Mensalidades estornadas pelo sistema (ESTORNADA vinda do gateway sem pedido, ex.: chargeback, nao entra). */
export async function mensalidadesEstornadas() {
  const l = await db.pedidoEstorno.findMany({ where: { tipo: "MENSALIDADE", status: { in: STATUS_EFETIVOS } }, select: { referenciaId: true } });
  return l.map((x) => x.referenciaId);
}

/** Pagamento da comanda cujo dinheiro entrou (pago, ou estornado depois). */
export const PAGAMENTO_RECEBIDO = { OR: [{ status: "PAGO" as const }, { status: "CANCELADO" as const, estornadoEm: { not: null } }] };
