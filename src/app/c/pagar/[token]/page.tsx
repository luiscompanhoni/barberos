import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Check, ShieldCheck } from "lucide-react";
import { CopiarTexto, EsperarPagamento } from "@/components/cliente/PagamentoCliente";
import { Marca } from "@/components/Marca";
import { configuracao } from "@/lib/agenda/carregar";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const dataBr = (d: Date) => d.toISOString().slice(0, 10).split("-").reverse().join("/");
const pixExpirado = (expiraEm: Date | null) => !!expiraEm && expiraEm.getTime() < Date.now();

function Valor({ centavos }: { centavos: number }) {
  const [inteiro, dec] = (centavos / 100).toFixed(2).split(".");
  return (
    <p className="mt-1 text-5xl font-black">
      R$ {Number(inteiro).toLocaleString("pt-BR")}<span className="text-2xl">,{dec}</span>
    </p>
  );
}

/** Pagina publica de pagamento de uma mensalidade (link enviado no WhatsApp). */
export default async function Pagar(props: PageProps<"/c/pagar/[token]">) {
  const { token } = await props.params;
  const c = await db.cobranca.findUnique({
    where: { tokenPublico: token },
    include: { assinatura: { include: { plano: { select: { nome: true } }, cliente: { select: { nome: true } } } } },
  });
  if (!c) notFound();
  // Gateways com fatura propria (Asaas): manda para la.
  if (c.link && /^https?:\/\//.test(c.link)) redirect(c.link);
  const cfg = await configuracao();

  const a = c.assinatura;
  return (
    <main className="flex flex-1 items-center justify-center px-5 py-12">
      <section className="entrar-suave w-full max-w-md text-center">
        <div className="flex justify-center"><Marca nome={cfg.nomeBarbearia} /></div>

        {c.status === "PAGA" ? (
          <>
            <div className="mx-auto mt-12 grid h-24 w-24 place-items-center rounded-full border border-ouro bg-ouro/10">
              <Check className="h-12 w-12 text-ouro" />
            </div>
            <h1 className="titulo-marca mt-7 text-3xl">Pagamento <span className="text-ouro">confirmado.</span></h1>
            <p className="mt-3 text-sm text-zinc-500">
              {a.plano.nome} em dia{a.cliente.nome ? `, ${a.cliente.nome.split(" ")[0]}` : ""}. Nos vemos na barbearia.
            </p>
            <Link className="btn-primario mt-8 w-full py-3" href="/c">Ir para meus horários</Link>
          </>
        ) : (
          <>
            <p className="eyebrow mt-12">{c.forma === "BOLETO" ? "Boleto" : c.forma === "CARTAO" ? "Cartão" : "Pagamento Pix"}</p>
            <h1 className="mt-3 text-sm font-semibold text-zinc-500">{a.plano.nome}</h1>
            <Valor centavos={c.valorCentavos} />
            <p className="mt-2 text-xs text-zinc-500">Mensalidade com vencimento em {dataBr(c.vencimento)}</p>

            <div className="mt-8 space-y-4">
              {c.status === "CANCELADA" || c.status === "ESTORNADA" ? (
                <p className="rounded-xl bg-zinc-100 p-4 text-sm text-zinc-600">Essa cobrança não está mais valendo. Chame a barbearia no WhatsApp.</p>
              ) : c.forma === "PIX" && c.pixCopiaECola ? (
                pixExpirado(c.expiraEm) ? (
                  <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">Esse Pix expirou. Peça um novo para a barbearia no WhatsApp.</p>
                ) : (
                  <>
                    {c.pixQrUrl && (
                      <div className="mx-auto w-fit rounded-2xl bg-[#f5f5f5] p-4">
                        {/* eslint-disable-next-line @next/next/no-img-element -- imagem do QR vem da Pagar.me */}
                        <img src={c.pixQrUrl} alt="QR code do Pix" className="h-52 w-52" />
                      </div>
                    )}
                    <CopiarTexto rotulo="Pix copia e cola" texto={c.pixCopiaECola} />
                    <EsperarPagamento token={token} />
                  </>
                )
              ) : c.forma === "BOLETO" && (c.boletoUrl || c.boletoLinha) ? (
                <>
                  {c.boletoUrl && <a className="btn-primario w-full py-3" href={c.boletoUrl} target="_blank" rel="noreferrer">Abrir boleto</a>}
                  {c.boletoLinha && <CopiarTexto rotulo="Linha digitável" texto={c.boletoLinha} />}
                  <p className="text-xs text-zinc-500">O boleto pode levar até 3 dias úteis para compensar.</p>
                </>
              ) : c.forma === "CARTAO" && a.tokenPublico ? (
                <>
                  <p className="rounded-xl bg-red-50 p-4 text-sm text-red-800">O cartão não passou nessa mensalidade.</p>
                  <Link className="btn-primario w-full py-3" href={`/c/assinar/${a.tokenPublico}`}>Atualizar cartão</Link>
                </>
              ) : (
                <p className="text-sm text-zinc-600">Pagamento ainda sendo preparado. Tente de novo em instantes.</p>
              )}
            </div>
          </>
        )}
        <p className="mt-10 flex items-center justify-center gap-2 text-[11px] text-zinc-500">
          <ShieldCheck size={14} /> Ambiente de pagamento seguro
        </p>
      </section>
    </main>
  );
}
