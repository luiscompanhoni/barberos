"use client";

import { useState } from "react";
import { CaixaTela } from "./CaixaTela";
import { ConciliacaoTela } from "./ConciliacaoTela";
import { DespesasTela } from "./DespesasTela";
import { EstornosTela } from "./EstornosTela";
import { LinksPagamentoTela } from "./LinksPagamentoTela";
import { ResultadoTela } from "./ResultadoTela";
import { ResumoTela } from "./ResumoTela";

export type Aba = "caixa" | "despesas" | "links" | "estornos" | "conciliacao" | "resumo" | "resultado";
const ABAS: { k: Aba; r: string; resultado?: boolean }[] = [
  { k: "caixa", r: "Caixa" }, { k: "despesas", r: "Despesas" }, { k: "links", r: "Links de pagamento" }, { k: "estornos", r: "Estornos" },
  { k: "conciliacao", r: "Conciliação" }, { k: "resumo", r: "Resumo do mês", resultado: true },
  { k: "resultado", r: "Resultado e Celcash", resultado: true },
];

/** Financeiro: caixa, contas a pagar, links, estornos, conciliacao e (com a permissao "resultado") o resumo do mes. */
export function FinanceiroTela({ verResultado, gestao, abaInicial = "caixa", estornosPendentes = 0 }: { verResultado: boolean; gestao: boolean; abaInicial?: Aba; estornosPendentes?: number }) {
  const [aba, setAba] = useState<Aba>(abaInicial);
  const [pendentes, setPendentes] = useState(estornosPendentes);
  const abas = ABAS.filter((a) => !a.resultado || verResultado);
  return (
    <div className="space-y-4">
      <div>
        <p className="eyebrow">Financeiro</p>
        <h1 className="titulo-marca text-2xl">{ABAS.find((a) => a.k === aba)!.r}</h1>
      </div>
      <div className="flex flex-wrap gap-2 print:hidden">
        {abas.map((a) => (
          <button key={a.k} className={aba === a.k ? "btn-primario" : "btn"} onClick={() => setAba(a.k)}>
            {a.r}
            {a.k === "estornos" && pendentes > 0 && (
              <span className="rounded-full bg-amber-500 px-1.5 text-[11px] font-bold text-black" title="Pedidos de estorno esperando o dono">{pendentes}</span>
            )}
          </button>
        ))}
      </div>
      {aba === "caixa" ? <CaixaTela /> : aba === "despesas" ? <DespesasTela /> : aba === "links" ? <LinksPagamentoTela />
        : aba === "estornos" ? <EstornosTela onMudou={() => fetch("/api/estornos").then((r) => r.json()).then((x) => setPendentes(x.pendentes?.filter((p: { status: string }) => p.status === "PENDENTE").length ?? 0)).catch(() => {})} />
          : aba === "conciliacao" ? <ConciliacaoTela gestao={gestao} /> : aba === "resultado" ? <ResultadoTela /> : <ResumoTela />}
    </div>
  );
}
