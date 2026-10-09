import { notFound } from "next/navigation";
import { BotaoPagarSimulado } from "@/components/cliente/BotaoPagarSimulado";
import { db } from "@/lib/db";
import { provedorPagamento } from "@/lib/pagamentos/gateway";

export const dynamic = "force-dynamic";

/** Faz o papel da fatura do Asaas em testes locais (PAGAMENTOS_PROVIDER=simulado). */
export default async function PagamentoSimulado(props: PageProps<"/c/pagamento-simulado/[id]">) {
  if (provedorPagamento() !== "simulado") notFound();
  const { id } = await props.params;
  const c = await db.cobrancaSimulada.findUnique({ where: { id } });
  if (!c) notFound();
  const assinatura = await db.assinatura.findUnique({
    where: { gatewayId: c.assinaturaGatewayId },
    include: { plano: { select: { nome: true } }, cliente: { select: { nome: true } } },
  });

  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <div className="cartao w-full max-w-sm space-y-3 p-6">
        <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
          Pagamento de TESTE (modo simulado). Nenhum dinheiro é cobrado. Em produção esta tela é a fatura do Asaas.
        </p>
        <h1 className="text-lg font-semibold">{assinatura?.plano.nome ?? "Pagamento avulso"}</h1>
        <p className="text-sm text-zinc-600">{assinatura?.cliente.nome}</p>
        <p className="text-3xl font-semibold">{(c.valorCentavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</p>
        <p className="text-sm text-zinc-500">Vencimento {c.vencimento.toISOString().slice(0, 10).split("-").reverse().join("/")}</p>
        {c.status === "PAGA" ? (
          <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">Pago ✅</p>
        ) : c.status === "CANCELADA" ? (
          <p className="rounded-lg bg-zinc-100 p-3 text-sm text-zinc-600">Cobrança cancelada.</p>
        ) : (
          <BotaoPagarSimulado id={c.id} />
        )}
      </div>
    </main>
  );
}
