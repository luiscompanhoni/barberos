import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { createHash } from "node:crypto";
import { fonteProvaRecebimento, provaRecebimentoValida } from "@/lib/pagamentos/recebimento";

type Janela = { gte: Date; lt: Date };
/** Receita bruta comprovada por pagamento; liquidação, tarifas e devoluções não são inferidas. */
export async function recebimentosMensalidades(janela: Janela, c: Pick<Prisma.TransactionClient, "cobranca"> = db) {
  const lista = await c.cobranca.findMany({
    where: { OR: [
      { recebidoConfirmadoEm: janela },
      // Sem data comprovada não atribui a competência pelo vencimento @db.Date.
      { OR: [{ valorRecebidoConfirmadoCentavos: null }, { recebimentoPendente: { not: null } }], status: { in: ["PAGA", "ESTORNADA"] }, AND: [{ OR: [{ pagaEm: janela }, { pagaEm: null }] }] },
    ] },
    select: { id: true, gatewayId: true, status: true, valorCentavos: true, valorRecebidoConfirmadoCentavos: true, recebidoConfirmadoEm: true, provaRecebimento: true, recebimentoPendente: true, assinatura: { select: { clienteId: true } } },
  });
  const confirmadas = lista.filter(x => provaRecebimentoValida(x) && !x.recebimentoPendente);
  const ids = new Set(confirmadas.map(x => x.id));
  const pendentes = lista.filter(x => !ids.has(x.id));
  const porFonte = { celcash: 0, pagarme: 0, asaas: 0, simulado: 0, indefinida: 0 };
  for (const c of confirmadas) porFonte[fonteProvaRecebimento(c.provaRecebimento)] += c.valorRecebidoConfirmadoCentavos!;
  return {
    porFonte,
    total: confirmadas.reduce((s, x) => s + x.valorRecebidoConfirmadoCentavos!, 0),
    totalElegivelComissoes: confirmadas.filter(x => x.status === "PAGA" || x.status === "ESTORNADA").reduce((s, x) => s + x.valorRecebidoConfirmadoCentavos!, 0),
    quantidade: confirmadas.length,
    registros: confirmadas.map(x => ({ id: x.id, clienteId: x.assinatura.clienteId, fonte: fonteProvaRecebimento(x.provaRecebimento), valorCentavos: x.valorRecebidoConfirmadoCentavos!, em: x.recebidoConfirmadoEm!, provaSha256: createHash("sha256").update(JSON.stringify(x.provaRecebimento)).digest("hex") })),
    pendentes: pendentes.map(x => ({ id: x.id, gatewayId: x.gatewayId, valorCobradoCentavos: x.valorCentavos })),
    nominalPendente: pendentes.reduce((s, x) => s + x.valorCentavos, 0),
    completo: !pendentes.length,
  };
}
