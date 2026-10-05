"use client";

import { useState } from "react";

/**
 * Tokeniza o cartao direto na Pagar.me (POST /tokens com a chave PUBLICA, sem
 * cabecalho de autorizacao) e manda so o token para o BarberOS.
 * Docs: https://docs.pagar.me/reference/criar-token-cart%C3%A3o-1
 */
export function FormularioCartao(p: { chavePublica: string; assinatura: string; troca?: boolean }) {
  const [numero, setNumero] = useState("");
  const [nome, setNome] = useState("");
  const [validade, setValidade] = useState("");
  const [cvv, setCvv] = useState("");
  const [erro, setErro] = useState("");
  const [estado, setEstado] = useState<"form" | "enviando" | "ok">("form");

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    const num = numero.replace(/\D/g, "");
    const [mes, ano] = validade.split("/").map((x) => x.trim());
    if (num.length < 13 || num.length > 19) return setErro("Número do cartão inválido.");
    if (nome.trim().length < 3) return setErro("Digite o nome como está no cartão.");
    if (!/^\d{2}$/.test(mes ?? "") || Number(mes) < 1 || Number(mes) > 12 || !/^\d{2}(\d{2})?$/.test(ano ?? "")) return setErro("Validade no formato MM/AA.");
    if (!/^\d{3,4}$/.test(cvv)) return setErro("Código de segurança inválido.");

    setEstado("enviando");
    try {
      const r = await fetch(`https://api.pagar.me/core/v5/tokens?appId=${encodeURIComponent(p.chavePublica)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "card", card: { number: num, holder_name: nome.trim(), exp_month: Number(mes), exp_year: Number(ano), cvv } }),
      });
      const t = await r.json().catch(() => ({}));
      if (!r.ok || !t.id) throw new Error("Não conseguimos validar o cartão. Confira os dados.");

      const s = await fetch("/api/pagamentos/cartao", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assinatura: p.assinatura, cartaoToken: t.id }),
      });
      const j = await s.json().catch(() => ({}));
      if (!s.ok) throw new Error(j.erro ?? "O cartão não foi aceito.");
      setEstado("ok");
      setNumero(""); setCvv("");
    } catch (e) {
      setErro((e as Error).message);
      setEstado("form");
    }
  }

  if (estado === "ok") {
    return (
      <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
        {p.troca ? "Cartão atualizado ✅" : "Pagamento em processamento ✅ Você recebe a confirmação no WhatsApp em instantes."}
      </p>
    );
  }

  return (
    <form onSubmit={enviar} className="space-y-3" autoComplete="on">
      <div>
        <label className="rotulo" htmlFor="cc-num">Número do cartão</label>
        <input id="cc-num" className="campo" inputMode="numeric" autoComplete="cc-number" placeholder="0000 0000 0000 0000"
          value={numero} onChange={(e) => setNumero(e.target.value.replace(/[^\d ]/g, "").slice(0, 23))} />
      </div>
      <div>
        <label className="rotulo" htmlFor="cc-nome">Nome no cartão</label>
        <input id="cc-nome" className="campo" autoComplete="cc-name" value={nome} onChange={(e) => setNome(e.target.value)} />
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
          <input id="cc-cvv" className="campo" inputMode="numeric" autoComplete="cc-csc" maxLength={4} value={cvv}
            onChange={(e) => setCvv(e.target.value.replace(/\D/g, ""))} />
        </div>
      </div>
      {erro && <p className="text-sm text-red-600">{erro}</p>}
      <button className="btn-primario w-full py-2" disabled={estado === "enviando"}>
        {estado === "enviando" ? "Processando..." : p.troca ? "Salvar novo cartão" : "Pagar e ativar plano"}
      </button>
      <p className="text-center text-xs text-zinc-500">🔒 Os dados do cartão vão direto para a Pagar.me (Stone). A barbearia não vê nem guarda o número.</p>
    </form>
  );
}
