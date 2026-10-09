"use client";

import { useState } from "react";
import { CaixaTela } from "./CaixaTela";
import { ConciliacaoTela } from "./ConciliacaoTela";
import { DespesasTela } from "./DespesasTela";
import { LinksPagamentoTela } from "./LinksPagamentoTela";
import { ResumoTela } from "./ResumoTela";

type Aba = "caixa" | "despesas" | "links" | "conciliacao" | "resumo";
const ABAS: { k: Aba; r: string; dono?: boolean }[] = [
  { k: "caixa", r: "Caixa" }, { k: "despesas", r: "Despesas" }, { k: "links", r: "Links de pagamento" },
  { k: "conciliacao", r: "Conciliação" }, { k: "resumo", r: "Resumo do mês", dono: true },
];

/** Financeiro: caixa, contas a pagar, links de pagamento, conciliacao e (so o dono) o resumo do mes. */
export function FinanceiroTela({ dono }: { dono: boolean }) {
  const [aba, setAba] = useState<Aba>("caixa");
  const abas = ABAS.filter((a) => !a.dono || dono);
  return (
    <div className="space-y-4">
      <div>
        <p className="eyebrow">Financeiro</p>
        <h1 className="titulo-marca text-2xl">{ABAS.find((a) => a.k === aba)!.r}</h1>
      </div>
      <div className="flex flex-wrap gap-2 print:hidden">
        {abas.map((a) => <button key={a.k} className={aba === a.k ? "btn-primario" : "btn"} onClick={() => setAba(a.k)}>{a.r}</button>)}
      </div>
      {aba === "caixa" ? <CaixaTela /> : aba === "despesas" ? <DespesasTela /> : aba === "links" ? <LinksPagamentoTela /> : aba === "conciliacao" ? <ConciliacaoTela dono={dono} /> : <ResumoTela />}
    </div>
  );
}
