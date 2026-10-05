import { notFound } from "next/navigation";
import { FormularioCartao } from "@/components/cliente/FormularioCartao";
import { db } from "@/lib/db";
import { provedorPagamento } from "@/lib/pagamentos/gateway";

export const dynamic = "force-dynamic";

const reais = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * Cartao da assinatura (Pagar.me): o numero vai do navegador direto para a
 * Pagar.me e vira token. Serve para o 1o pagamento e para trocar de cartao.
 */
export default async function AssinarComCartao(props: PageProps<"/c/assinar/[token]">) {
  if (provedorPagamento() !== "pagarme") notFound();
  const chavePublica = process.env.PAGARME_PUBLIC_KEY;
  const { token } = await props.params;
  const a = await db.assinatura.findUnique({
    where: { tokenPublico: token },
    include: { plano: { select: { nome: true } }, cliente: { select: { nome: true } } },
  });
  if (!a || a.formaPagamento !== "CARTAO" || !chavePublica) notFound();

  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <div className="cartao w-full max-w-sm space-y-3 p-6">
        <p className="text-sm text-zinc-500">{a.cliente.nome}</p>
        <h1 className="text-lg font-semibold">{a.plano.nome}</h1>
        <p className="text-2xl font-semibold">{reais(a.precoCentavos)}<span className="text-sm font-normal text-zinc-500">/mês no cartão</span></p>
        {a.status === "CANCELADA" ? (
          <p className="rounded-lg bg-zinc-100 p-3 text-sm text-zinc-600">Essa assinatura foi cancelada.</p>
        ) : a.status === "ATIVA" && a.gatewayId ? (
          <>
            <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">Assinatura ativa ✅ Quer trocar o cartão?</p>
            <FormularioCartao chavePublica={chavePublica} assinatura={token} troca />
          </>
        ) : (
          <FormularioCartao chavePublica={chavePublica} assinatura={token} troca={!!a.gatewayId} />
        )}
      </div>
    </main>
  );
}
