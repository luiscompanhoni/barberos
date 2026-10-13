"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, CreditCard, LoaderCircle, QrCode, RotateCcw, ShieldCheck, XCircle } from "lucide-react";
import { api, ErroApi } from "@/lib/cliente-api";
import type { EstadoCheckout, ModoCartao } from "@/lib/pagamentos/checkout-regras";
import { CartaoForm } from "./CartaoForm";
import { PixPainel } from "./PixPainel";

/** O que esta sendo pago (cada um tem sua API). */
export type AlvoCheckout = { tipo: "link"; token: string } | { tipo: "horario"; id: string } | { tipo: "assinatura"; token: string };
type Forma = "CARTAO" | "PIX";

const URL_API: Record<AlvoCheckout["tipo"], (a: AlvoCheckout) => string> = {
  link: (a) => `/api/pagamentos/link/${(a as { token: string }).token}`,
  horario: (a) => `/api/cliente/agendamentos/${(a as { id: string }).id}/pagar`,
  assinatura: (a) => `/api/pagamentos/assinatura/${(a as { token: string }).token}`,
};
const POLLING_MS = 4000;
const CONFERIR_A_CADA = 6; // a cada ~24 s consulta o meio de pagamento (o resto so le o banco)

function Valor({ centavos, mensal }: { centavos: number; mensal?: boolean }) {
  const [inteiro, dec] = (centavos / 100).toFixed(2).split(".");
  return (
    <p className="mt-1 text-5xl font-black tracking-tight">
      R$ {Number(inteiro).toLocaleString("pt-BR")}<span className="text-2xl">,{dec}</span>
      {mensal && <span className="ml-1 text-base font-semibold text-zinc-500">/mês</span>}
    </p>
  );
}

/**
 * Checkout do BarberOS: resumo do que esta sendo pago, abas Cartao | Pix, polling ate
 * o status mudar e as telas de sucesso / recusa. Os dados do cartao nunca passam pelo
 * servidor: so o token gerado no navegador.
 */
export function Checkout(p: {
  alvo: AlvoCheckout;
  resumo: { titulo: string; descricao?: string | null; valorCentavos: number; mensal?: boolean; para?: string | null };
  formas: Forma[];
  modoCartao: ModoCartao;
  chavePublica: string | null;
  parcelasMax?: number;
  pedir?: { cpf: boolean; email: boolean };
  inicial: EstadoCheckout;
  /** Assinatura ativa: o cartao so e trocado. */
  troca?: boolean;
  sucesso?: { texto: string; href: string; botao: string };
}) {
  const url = URL_API[p.alvo.tipo](p.alvo);
  const [estado, setEstado] = useState<EstadoCheckout>(p.inicial);
  const [aba, setAba] = useState<Forma>(p.inicial.forma === "PIX" && p.formas.includes("PIX") ? "PIX" : p.formas[0] ?? "PIX");
  const [dados, setDados] = useState({ cpf: "", email: "" });
  const [pedir, setPedir] = useState(p.pedir ?? { cpf: false, email: false });
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const [recusa, setRecusa] = useState<string | null>(null);
  const [trocado, setTrocado] = useState(false);
  const ticks = useRef(0);

  const ler = (r: { checkout?: EstadoCheckout | null }) => r.checkout && setEstado(r.checkout);

  // Polling: enquanto tem Pix na tela ou cartao em analise.
  const esperando = estado.status === "PENDENTE" && (!!estado.pix || !!estado.processando);
  const conferir = useCallback(async (completo: boolean) => {
    const r = await api<{ checkout?: EstadoCheckout }>(`${url}${completo ? "" : "?rapido=1"}`).catch(() => null);
    if (r) ler(r);
  }, [url]);
  useEffect(() => {
    if (!esperando) return;
    const t = setInterval(() => conferir(++ticks.current % CONFERIR_A_CADA === 0), POLLING_MS);
    return () => clearInterval(t);
  }, [esperando, conferir]);

  async function pagar(corpo: Record<string, unknown>) {
    setErro("");
    setRecusa(null);
    setOcupado(true);
    try {
      ler(await api<{ checkout?: EstadoCheckout }>(url, {
        method: "POST",
        body: { ...corpo, ...(pedir.cpf && dados.cpf ? { cpf: dados.cpf } : {}), ...(pedir.email && dados.email ? { email: dados.email } : {}) },
      }));
      if (corpo.forma === "CARTAO" && p.troca) setTrocado(true);
    } catch (e) {
      const c = e instanceof ErroApi ? e.codigo : undefined;
      if (c === "cpf" || c === "email") setPedir((x) => ({ ...x, [c]: true }));
      if (c === "cartao_recusado") setRecusa((e as Error).message);
      else setErro((e as Error).message);
      if (c === "ja_pago") conferir(true);
    } finally {
      setOcupado(false);
    }
  }

  // ---- telas finais
  if (estado.status === "PAGO" || trocado) {
    return (
      <div className="text-center">
        <div className="mx-auto mt-10 grid h-24 w-24 place-items-center rounded-full border border-ouro bg-ouro/10">
          <Check className="h-12 w-12 text-ouro" />
        </div>
        <h1 className="titulo-marca mt-7 text-3xl">{trocado ? "Cartão " : "Pagamento "}<span className="text-ouro">{trocado ? "atualizado." : "confirmado."}</span></h1>
        <p className="mt-3 text-sm text-zinc-500">{trocado ? "As próximas mensalidades vão para o cartão novo." : (p.sucesso?.texto ?? "Recebemos seu pagamento. Você também recebe a confirmação no WhatsApp.")}</p>
        {p.sucesso && <Link className="btn-primario mt-8 w-full py-3" href={p.sucesso.href}>{p.sucesso.botao}</Link>}
      </div>
    );
  }
  if (estado.status === "CANCELADO" || estado.status === "EXPIRADO") {
    return (
      <div className="text-center">
        <XCircle className="mx-auto mt-10 h-16 w-16 text-zinc-400" />
        <h1 className="titulo-marca mt-6 text-2xl">{estado.status === "EXPIRADO" ? "Link expirado" : "Pagamento cancelado"}</h1>
        <p className="mt-3 text-sm text-zinc-500">{estado.mensagem ?? "Esse pagamento não está mais valendo. Fale com a barbearia no WhatsApp."}</p>
      </div>
    );
  }

  const pix = estado.pix; // vencido: o painel do Pix oferece gerar outro
  return (
    <div>
      <div className="text-center">
        <p className="eyebrow mt-10">{p.troca ? "Trocar cartão" : p.resumo.mensal ? "Assinatura" : "Pagamento"}</p>
        <h1 className="mt-3 text-base font-semibold">{p.resumo.titulo}</h1>
        {p.resumo.descricao && <p className="mt-1 text-xs text-zinc-500">{p.resumo.descricao}</p>}
        <Valor centavos={p.resumo.valorCentavos} mensal={p.resumo.mensal} />
        {p.resumo.para && <p className="mt-2 text-xs text-zinc-500">Para {p.resumo.para}</p>}
      </div>

      {p.formas.length > 1 && !p.troca && (
        <div className="mt-8 grid grid-cols-2 gap-1 rounded-2xl border border-zinc-200 p-1" role="tablist">
          {p.formas.map((f) => (
            <button key={f} type="button" role="tab" aria-selected={aba === f} onClick={() => { setAba(f); setErro(""); }}
              className={`flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold transition ${aba === f ? "bg-ouro text-[#111]" : "text-zinc-500 hover:text-zinc-900"}`}>
              {f === "CARTAO" ? <><CreditCard size={16} /> Cartão</> : <><QrCode size={16} /> Pix</>}
            </button>
          ))}
        </div>
      )}

      <div className="mt-6 space-y-4">
        {(pedir.cpf || pedir.email) && !(aba === "PIX" && estado.pix) && (
          <div className="cartao space-y-3 text-left">
            <p className="text-xs text-zinc-500">O meio de pagamento pede seus dados (só na primeira vez).</p>
            {pedir.cpf && (
              <div>
                <label className="rotulo" htmlFor="ck-cpf">CPF</label>
                <input id="ck-cpf" className="campo" inputMode="numeric" autoComplete="off" placeholder="000.000.000-00" value={dados.cpf}
                  onChange={(e) => setDados({ ...dados, cpf: e.target.value.replace(/[^\d.-]/g, "").slice(0, 14) })} />
              </div>
            )}
            {pedir.email && (
              <div>
                <label className="rotulo" htmlFor="ck-email">E-mail</label>
                <input id="ck-email" className="campo" type="email" autoComplete="email" placeholder="voce@email.com" value={dados.email}
                  onChange={(e) => setDados({ ...dados, email: e.target.value })} />
              </div>
            )}
          </div>
        )}

        {aba === "PIX" ? (
          pix ? (
            <PixPainel copiaECola={pix.copiaECola} qrUrl={pix.qrUrl} expiraEm={pix.expiraEm} linkTeste={estado.link}
              ocupado={ocupado} onNovoPix={() => pagar({ forma: "PIX" })} />
          ) : (
            <div className="space-y-3 text-center">
              <p className="text-sm text-zinc-500">Pague na hora pelo app do seu banco. A confirmação é automática.</p>
              <button type="button" className="btn-primario w-full py-3" disabled={ocupado} onClick={() => pagar({ forma: "PIX" })}>
                {ocupado ? <LoaderCircle size={16} className="animate-spin" /> : <QrCode size={16} />} Gerar Pix
              </button>
            </div>
          )
        ) : estado.processando ? (
          <p className="flex items-center justify-center gap-2 rounded-xl bg-zinc-50 p-4 text-sm text-zinc-600">
            <LoaderCircle size={16} className="animate-spin text-ouro" /> Cartão em análise… esta página atualiza sozinha.
          </p>
        ) : recusa ? (
          <div className="space-y-3 text-center">
            <div className="rounded-xl bg-red-50 p-4 text-sm text-red-800">
              <XCircle size={22} className="mx-auto mb-2" />
              <p className="font-semibold">Pagamento recusado</p>
              <p className="mt-1">{recusa}</p>
            </div>
            <button type="button" className="btn-primario w-full py-3" onClick={() => setRecusa(null)}><RotateCcw size={16} /> Tentar outro cartão</button>
            {p.formas.includes("PIX") && !p.troca && <button type="button" className="btn w-full" onClick={() => { setRecusa(null); setAba("PIX"); }}><QrCode size={15} /> Pagar com Pix</button>}
          </div>
        ) : p.modoCartao === "token" || p.modoCartao === "teste" ? (
          <CartaoForm modo={p.modoCartao} chavePublica={p.chavePublica} valorCentavos={p.resumo.valorCentavos} parcelasMax={p.parcelasMax}
            rotuloBotao={p.troca ? "Salvar novo cartão" : p.resumo.mensal ? "Pagar e ativar o plano" : "Pagar com cartão"}
            onToken={(cartaoToken, parcelas) => pagar({ forma: "CARTAO", cartaoToken, ...(p.parcelasMax && p.parcelasMax > 1 ? { parcelas } : {}) })} />
        ) : (
          <p className="flex gap-2 rounded-xl bg-amber-50 p-4 text-left text-sm text-amber-900">
            <AlertTriangle size={18} className="shrink-0" />
            <span>O pagamento com cartão ainda não está disponível aqui (chave do meio de pagamento não configurada).{p.formas.includes("PIX") ? " Use o Pix ou fale com a barbearia." : " Fale com a barbearia."}</span>
          </p>
        )}
        {erro && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{erro}</p>}
      </div>

      <p className="mt-10 flex items-center justify-center gap-2 text-[11px] text-zinc-500">
        <ShieldCheck size={14} /> {p.modoCartao === "teste" ? "Ambiente de teste: nada é cobrado" : "Ambiente de pagamento seguro"}
      </p>
    </div>
  );
}
