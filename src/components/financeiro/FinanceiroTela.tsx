"use client";

import { useState } from "react";
import Link from "next/link";
import { CaixaTela } from "./CaixaTela";
import { ConciliacaoTela } from "./ConciliacaoTela";
import { DespesasTela } from "./DespesasTela";
import { EstornosTela } from "./EstornosTela";
import { LinksPagamentoTela } from "./LinksPagamentoTela";
import { ResultadoTela } from "./ResultadoTela";
import { ResumoTela } from "./ResumoTela";

export type Aba = "caixa" | "despesas" | "links" | "estornos" | "conciliacao" | "resumo" | "resultado";
const ABAS: { k: Aba; r: string; lucro?: boolean }[] = [
  { k: "caixa", r: "Caixa" }, { k: "despesas", r: "Despesas" }, { k: "links", r: "Links de pagamento" }, { k: "estornos", r: "Estornos" },
  { k: "conciliacao", r: "Conciliação" }, { k: "resumo", r: "Resumo do mês", lucro: true },
  { k: "resultado", r: "Resultado (Celcash e Stone)", lucro: true },
];

/** Financeiro: caixa, contas a pagar, links, estornos, conciliacao e (com a permissao "lucro") o resumo e o resultado do mes. */
export function FinanceiroTela({ verLucro, gestao, abaInicial = "caixa", estornosPendentes = 0 }: { verLucro: boolean; gestao: boolean; abaInicial?: Aba; estornosPendentes?: number }) {
  const [aba, setAba] = useState<Aba>(abaInicial);
  const [pendentes, setPendentes] = useState(estornosPendentes);
  const abas = ABAS.filter((a) => a.k !== "caixa" && (!a.lucro || verLucro));
  return (
    <div className="space-y-4">
      <header className="cabecalho-gestao">
        <div><p className="eyebrow">Gestão da Black</p>
          <h1 className="titulo-marca mt-1 text-3xl">Financeiro</h1>
          <p className="mt-2 text-sm text-zinc-600">Acompanhe o resultado, organize despesas e confira os recebimentos.</p></div>
        <Link href="/caixa" className="btn">Abrir caixa do balcão →</Link>
      </header>
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
