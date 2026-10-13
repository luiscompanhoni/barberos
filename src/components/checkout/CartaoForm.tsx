"use client";

import { useState } from "react";
import { CreditCard, Lock, LoaderCircle } from "lucide-react";
import type { ModoCartao } from "@/lib/pagamentos/checkout-regras";
import { valorParcela } from "@/lib/pagamentos/checkout-regras";
import { reais } from "@/lib/cliente-api";

/** Cartao de teste recusado no modo simulado (qualquer outro numero valido e aprovado). */
export const CARTAO_TESTE_RECUSADO = "4000000000000002";

/** Bandeira pelo inicio do numero (so para mostrar). */
export function bandeira(num: string) {
  if (/^4/.test(num)) return "Visa";
  if (/^(5[1-5]|2[2-7])/.test(num)) return "Mastercard";
  if (/^3[47]/.test(num)) return "Amex";
  if (/^(4011|4312|4389|4514|4576|5041|5066|5067|509|6277|6362|6363|650|6516|6550)/.test(num)) return "Elo";
  if (/^(606282|3841)/.test(num)) return "Hipercard";
  return null;
}

/**
 * Tokeniza o cartao direto na Pagar.me (POST /tokens com a chave PUBLICA, sem
 * cabecalho de autorizacao). Docs: https://docs.pagar.me/reference/criar-token-cart%C3%A3o-1
 */
async function tokenizar(chavePublica: string, c: { number: string; holder_name: string; exp_month: number; exp_year: number; cvv: string }) {
  const r = await fetch(`https://api.pagar.me/core/v5/tokens?appId=${encodeURIComponent(chavePublica)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "card", card: c }),
  });
  const t = await r.json().catch(() => ({}));
  if (!r.ok || !t.id) throw new Error("Não conseguimos validar o cartão. Confira os dados.");
  return t.id as string;
}

/**
 * Formulario do cartao. O numero vai do navegador para a Pagar.me e vira token; so o
 * token sobe para o BarberOS (onToken). No modo teste nada sai do navegador.
 */
export function CartaoForm(p: {
  modo: Extract<ModoCartao, "token" | "teste">;
  chavePublica: string | null;
  valorCentavos: number;
  parcelasMax?: number;
  rotuloBotao: string;
  onToken: (token: string, parcelas: number) => Promise<void>;
}) {
  const [numero, setNumero] = useState("");
  const [nome, setNome] = useState("");
  const [validade, setValidade] = useState("");
  const [cvv, setCvv] = useState("");
  const [parcelas, setParcelas] = useState(1);
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const num = numero.replace(/\D/g, "");
  const marca = bandeira(num);
  const max = Math.max(1, p.parcelasMax ?? 1);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    const [mes, ano] = validade.split("/").map((x) => x.trim());
    if (num.length < 13 || num.length > 19) return setErro("Número do cartão inválido.");
    if (nome.trim().length < 3) return setErro("Digite o nome como está no cartão.");
    if (!/^\d{2}$/.test(mes ?? "") || Number(mes) < 1 || Number(mes) > 12 || !/^\d{2}(\d{2})?$/.test(ano ?? "")) return setErro("Validade no formato MM/AA.");
    if (!/^\d{3,4}$/.test(cvv)) return setErro("Código de segurança inválido.");
    setEnviando(true);
    try {
      const token = p.modo === "teste"
        ? (num === CARTAO_TESTE_RECUSADO ? "token_recusado" : `token_teste${Date.now().toString(36)}`)
        : await tokenizar(p.chavePublica!, { number: num, holder_name: nome.trim(), exp_month: Number(mes), exp_year: Number(ano), cvv });
      setCvv("");
      await p.onToken(token, parcelas);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar} className="space-y-3 text-left" autoComplete="on">
      {p.modo === "teste" && (
        <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900">
          Modo de teste: nenhum cartão é cobrado. Use qualquer número válido (ex.: 4111 1111 1111 1111). O {CARTAO_TESTE_RECUSADO.replace(/(\d{4})(?=\d)/g, "$1 ")} é recusado.
        </p>
      )}
      <div>
        <label className="rotulo" htmlFor="cc-num">Número do cartão</label>
        <div className="relative">
          <input id="cc-num" className="campo pr-24" inputMode="numeric" autoComplete="cc-number" placeholder="0000 0000 0000 0000"
            value={numero} onChange={(e) => setNumero(e.target.value.replace(/\D/g, "").slice(0, 19).replace(/(\d{4})(?=\d)/g, "$1 "))} />
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center gap-1 text-xs font-semibold text-zinc-500">
            <CreditCard size={15} /> {marca}
          </span>
        </div>
      </div>
      <div>
        <label className="rotulo" htmlFor="cc-nome">Nome impresso no cartão</label>
        <input id="cc-nome" className="campo uppercase" autoComplete="cc-name" value={nome} onChange={(e) => setNome(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="rotulo" htmlFor="cc-val">Validade</label>
          <input id="cc-val" className="campo" inputMode="numeric" autoComplete="cc-exp" placeholder="MM/AA" value={validade}
            onChange={(e) => {
              const d = e.target.value.replace(/\D/g, "").slice(0, 4);
              setValidade(d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d);
            }} />
        </div>
        <div>
          <label className="rotulo" htmlFor="cc-cvv">CVV</label>
          <input id="cc-cvv" className="campo" inputMode="numeric" autoComplete="cc-csc" maxLength={4} placeholder="123" value={cvv}
            onChange={(e) => setCvv(e.target.value.replace(/\D/g, ""))} />
        </div>
      </div>
      {max > 1 && (
        <div>
          <label className="rotulo" htmlFor="cc-parc">Parcelas</label>
          <select id="cc-parc" className="campo" value={parcelas} onChange={(e) => setParcelas(Number(e.target.value))}>
            {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>{n === 1 ? `À vista · ${reais(p.valorCentavos)}` : `${n}x de ${reais(valorParcela(p.valorCentavos, n))} sem juros`}</option>
            ))}
          </select>
        </div>
      )}
      {erro && <p className="text-sm text-red-600">{erro}</p>}
      <button className="btn-primario w-full py-3" disabled={enviando}>
        {enviando ? <><LoaderCircle size={16} className="animate-spin" /> Processando…</> : <><Lock size={15} /> {p.rotuloBotao}</>}
      </button>
      <p className="text-center text-[11px] text-zinc-500">
        {p.modo === "teste" ? "Ambiente de teste." : "Os dados do cartão vão direto para a Pagar.me (Stone). A barbearia não vê nem guarda o número."}
      </p>
    </form>
  );
}
