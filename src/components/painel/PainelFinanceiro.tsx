"use client";

import Link from "next/link";
import { reais } from "@/lib/cliente-api";

export type FinanceiroPainel = { mes: string; faturamento: number; despesas: number; taxas: number; lucro: number; alertas: string[] };

/** Visao financeira do mes no painel (so com a permissao "lucro"). */
export function PainelFinanceiro({ financeiro: f }: { financeiro: FinanceiroPainel | null }) {
  return (
    <section className="space-y-3" aria-labelledby="financeiro-executivo">
      <div>
        <h2 id="financeiro-executivo" className="font-semibold">Visão financeira do mês{f ? ` · ${f.mes.split("-").reverse().join("/")}` : ""}</h2>
        <p className="text-xs text-zinc-500">Resultado provisório com os lançamentos registrados e taxas estimadas. Confira os detalhes antes de fechar o mês.</p>
      </div>
      {f ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metrica rotulo="Faturamento registrado" valor={reais(f.faturamento)}
              detalhe="Comandas, mensalidades e pagamentos online, descontados os estornos"
              link="/financeiro?aba=resultado" />
            <Metrica rotulo="Despesas + taxas" valor={reais(f.despesas + f.taxas)}
              detalhe={`${reais(f.despesas)} de despesas · ${reais(f.taxas)} de taxas`}
              link="/financeiro?aba=resultado" />
            <Metrica rotulo="Resultado provisório" valor={reais(f.lucro)}
              detalhe="Faturamento menos despesas e taxas registradas"
              tom={f.lucro >= 0 ? "bom" : "ruim"} destaque={f.lucro >= 0 ? "ouro" : "ruim"} link="/financeiro?aba=resultado" />
            <Metrica rotulo="Margem provisória"
              valor={f.faturamento > 0 ? `${(f.lucro / f.faturamento * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : "—"}
              detalhe={f.faturamento > 0 ? "Resultado provisório ÷ faturamento registrado" : "Sem faturamento positivo para calcular a margem"}
              link="/financeiro?aba=resultado" />
          </div>
          {f.alertas.length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-medium">Conferência financeira pendente</p>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {f.alertas.map((a) => <li key={a}>{a}</li>)}
              </ul>
              <Link href="/financeiro?aba=resultado" className="mt-2 inline-block font-semibold underline">Conferir lançamentos →</Link>
            </div>
          )}
        </>
      ) : (
        <p role="status" className="cartao text-sm text-zinc-500">Não foi possível carregar o resultado financeiro. <Link href="/financeiro?aba=resultado" className="underline">Abrir financeiro</Link></p>
      )}
    </section>
  );
}

export function Metrica(p: { rotulo: string; valor: string; detalhe: string; tom?: "bom" | "ruim"; barra?: number | null; link?: string; destaque?: "ouro" | "ruim" }) {
  const classe = `black-metric cartao space-y-2 ${p.destaque === "ouro" ? "black-metric--destaque" : p.destaque === "ruim" ? "black-metric--ruim" : ""}`;
  const conteudo = (
    <>
      <p className="text-sm text-zinc-500">{p.rotulo}</p>
      <p className="black-metric__valor text-[32px] text-zinc-900">{p.valor}</p>
      {p.barra !== undefined && p.barra !== null && (
        <div className="h-1.5 rounded-full bg-[#0c0d10]">
          <div className="h-1.5 rounded-full bg-ouro" style={{ width: `${Math.min(100, Math.round(p.barra * 100))}%` }} />
        </div>
      )}
      <p className={`text-xs ${p.tom === "bom" ? "text-emerald-700" : p.tom === "ruim" ? "text-red-700" : "text-zinc-500"}`}>{p.detalhe}</p>
      {p.link && <span className="inline-block pt-1 text-xs font-semibold text-ouro">Ver detalhes →</span>}
    </>
  );
  return p.link ? (
    <Link href={p.link} className={`${classe} block`}>{conteudo}</Link>
  ) : <div className={classe}>{conteudo}</div>;
}
