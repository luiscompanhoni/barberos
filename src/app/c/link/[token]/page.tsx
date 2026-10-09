import { notFound } from "next/navigation";
import { Checkout } from "@/components/checkout/Checkout";
import { Marca } from "@/components/Marca";
import { configuracao } from "@/lib/agenda/carregar";
import { dataLocal } from "@/lib/agenda/tempo";
import { linkPublico } from "@/lib/links/servico";
import { chavePublicaPagarme, modoCartaoCheckout } from "@/lib/pagamentos/checkout";

export const dynamic = "force-dynamic";

/** Pagina publica do link de pagamento (enviado pela barbearia no WhatsApp). */
export default async function PagarLink(props: PageProps<"/c/link/[token]">) {
  const { token } = await props.params;
  const dados = await linkPublico(token).catch(() => null);
  if (!dados) notFound();
  const cfg = await configuracao();
  const { link, checkout } = dados;
  const modo = modoCartaoCheckout();
  const ate = dataLocal(link.expiraEm, cfg.fuso).split("-").reverse().slice(0, 2).join("/");
  const msgFechado = checkout.status === "EXPIRADO" ? "Esse link expirou. Peça um novo para a barbearia no WhatsApp." : "Esse link foi cancelado. Fale com a barbearia no WhatsApp.";

  return (
    <main className="flex flex-1 items-center justify-center px-5 py-12">
      <section className="entrar-suave w-full max-w-md">
        <div className="flex justify-center"><Marca nome={cfg.nomeBarbearia} /></div>
        <Checkout
          alvo={{ tipo: "link", token }}
          resumo={{
            titulo: link.descricao,
            descricao: link.comandaNumero ? `Comanda #${link.comandaNumero} · vale até ${ate}` : `Vale até ${ate}`,
            valorCentavos: link.valorCentavos,
            para: link.nome,
          }}
          // Cartao hospedado (Celcash) nao entra no link: so Pix.
          formas={modo === "hospedado" ? ["PIX"] : ["CARTAO", "PIX"]}
          modoCartao={modo}
          chavePublica={chavePublicaPagarme()}
          parcelasMax={link.parcelasMax}
          pedir={link.pedir}
          inicial={{ ...checkout, mensagem: checkout.mensagem ?? msgFechado }}
          sucesso={{ texto: `Recebemos seu pagamento, ${link.nome.split(" ")[0]}. Obrigado! A confirmação também chega no WhatsApp.`, href: "/c", botao: "Ir para a área do cliente" }}
        />
      </section>
    </main>
  );
}
