import { notFound, redirect } from "next/navigation";
import { Checkout } from "@/components/checkout/Checkout";
import { Marca } from "@/components/Marca";
import { configuracao } from "@/lib/agenda/carregar";
import { checkoutDaAssinatura } from "@/lib/assinaturas/cartao-pix";
import { cobrancaEmAberto } from "@/lib/assinaturas/cobrancas";
import { db } from "@/lib/db";
import { chavePublicaPagarme, modoCartaoCheckout } from "@/lib/pagamentos/checkout";
import { provedorPagamento } from "@/lib/pagamentos/gateway";
import { assinaturaTesteUnico } from "@/lib/assinaturas/teste-venda";
import { checkoutLeonelDoTitular, ehCheckoutLeonel } from "@/lib/assinaturas/adesao-leonel";
import { sessaoAtual } from "@/lib/auth/sessao";

export const dynamic = "force-dynamic";

/**
 * Checkout do plano (Pagar.me): abas Cartao | Pix enquanto o 1o mes nao foi pago. No
 * cartao o numero vai do navegador direto para a Pagar.me e vira token; no Pix o
 * BarberOS gera o Pix do 1o mes. Plano ativo no cartao: serve para trocar o cartao.
 */
export default async function AssinarPlano(props: PageProps<"/c/assinar/[token]">) {
  if (provedorPagamento() !== "pagarme") notFound();
  const { token } = await props.params;
  const leonel = ehCheckoutLeonel(token);
  if (leonel) {
    const s = await sessaoAtual();
    if (!s) redirect(`/c/entrar?voltar=${encodeURIComponent(`/c/assinar/${token}`)}`);
    if (s.papel !== "CLIENTE" || !s.clienteId || !await checkoutLeonelDoTitular(token, { usuarioId: s.usuarioId, clienteId: s.clienteId })) notFound();
  }
  const a = await db.assinatura.findUnique({
    where: { tokenPublico: token },
    include: { plano: { select: { nome: true, formasPagamento: true } }, cliente: { select: { nome: true } } },
  });
  if (!a || a.formaPagamento === "BOLETO") notFound();
  // Mensalidade Pix atrasada: a pagina dela e a da cobranca.
  if (a.status === "ATRASADA" && a.formaPagamento === "PIX") {
    const aberta = await cobrancaEmAberto(a.id);
    if (aberta?.tokenPublico) redirect(`/c/pagar/${aberta.tokenPublico}`);
  }
  const cfg = await configuracao();
  const teste = assinaturaTesteUnico(a);
  const troca = !leonel && a.formaPagamento === "CARTAO" && !!a.gatewayId && (a.status === "ATIVA" || a.status === "ATRASADA");
  const inicial = troca ? { status: "PENDENTE" as const, forma: null, pix: null, link: null } : await checkoutDaAssinatura(token);
  const formas = troca || leonel ? (["CARTAO"] as const) : (["CARTAO", "PIX"] as const).filter((f) => a.plano.formasPagamento.includes(f));

  return (
    <main className="flex flex-1 items-center justify-center px-5 py-12">
      <section className="entrar-suave w-full max-w-md">
        <div className="flex justify-center"><Marca nome={cfg.nomeBarbearia} /></div>
        {a.status === "ATRASADA" && troca && (
          <p className="mt-8 rounded-xl bg-red-50 p-3 text-center text-sm text-red-800">O cartão não passou na última mensalidade. Cadastre outro cartão.</p>
        )}
        <Checkout
          alvo={{ tipo: "assinatura", token }}
          resumo={{ titulo: a.plano.nome, descricao: teste ? "Teste interno. Uma única cobrança, sem renovação automática." : "Cobrança mensal. Cancele quando quiser.", valorCentavos: a.precoCentavos, mensal: !teste, para: a.cliente.nome }}
          formas={[...formas]}
          modoCartao={modoCartaoCheckout()}
          chavePublica={chavePublicaPagarme()}
          inicial={inicial}
          troca={troca}
          sucesso={{ texto: `${a.plano.nome} ativo. Já pode marcar seu horário pelo plano!`, href: "/c", botao: "Ir para meus horários" }}
        />
      </section>
    </main>
  );
}
