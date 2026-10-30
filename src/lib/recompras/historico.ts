import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { resumoComanda } from "@/lib/comandas/regras";

type ClienteBanco = typeof db | Prisma.TransactionClient;
/** Concluido sem recebimento nao comprova compra. Cobertura de plano e antecipado pago valem. */
export async function ultimasCompras(clienteIds: string[], antes: Date, c: ClienteBanco = db) {
  const historico = await c.agendamento.findMany({
    where: { clienteId: { in: clienteIds }, status: "CONCLUIDO", fim: { lt: antes } },
    orderBy: { fim: "desc" },
    select: {
      id: true, clienteId: true, servicoId: true, fim: true, assinaturaId: true,
      antecipado: { select: { status: true } },
      itemComanda: { select: { comanda: { select: { status: true, descontoCentavos: true, itens: { select: { quantidade: true, precoUnitCentavos: true } }, pagamentos: true } } } },
    },
  });
  const ultimas = new Map<string, { id: string; clienteId: string; servicoId: string; fim: Date }>();
  const visitas = new Map<string, Date>();
  for (const a of historico) {
    const comanda = a.itemComanda?.comanda;
    const pago = a.assinaturaId || a.antecipado?.status === "PAGO" || (comanda?.status === "FECHADA" && resumoComanda(comanda.itens, comanda.pagamentos, comanda.descontoCentavos).podeFechar);
    if (!pago || comanda?.status === "CANCELADA") continue;
    const chave = `${a.clienteId}:${a.servicoId}`;
    if (!ultimas.has(chave)) ultimas.set(chave, { id: a.id, clienteId: a.clienteId, servicoId: a.servicoId, fim: a.fim });
    if (!visitas.has(a.clienteId)) visitas.set(a.clienteId, a.fim);
  }
  return { ultimas, visitas };
}
