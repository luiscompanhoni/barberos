"use client";

import { ArrowDownRight, ArrowUpRight, Info } from "lucide-react";
import { reais } from "@/lib/cliente-api";
import { CORES_CRM } from "@/components/visual/GraficosCrm";
import { valorDisponivel } from "@/components/visual/graficos-crm-regras";
import styles from "@/components/visual/graficos-crm.module.css";

export const pct = (v: number | null | undefined, casas = 0) => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(casas).replace(".", ",")}%`);
export const din = (c: number | null | undefined) => (c === null || c === undefined ? "—" : reais(c));
export const num = (v: number | null | undefined, casas = 0) => (v === null || v === undefined ? "—" : v.toLocaleString("pt-BR", { maximumFractionDigits: casas, minimumFractionDigits: casas }));

/** Cartao de numero com comparacao ao periodo anterior. `inverso`: subir e ruim (ex.: faltas). */
export function Kpi({ rotulo, valor, detalhe, variacao, inverso, ajuda, destaque }: {
  rotulo: string; valor: string; detalhe?: string; variacao?: number | null; inverso?: boolean; ajuda?: string; destaque?: boolean;
}) {
  const bom = variacao === null || variacao === undefined ? null : inverso ? variacao < 0 : variacao >= 0;
  return (
    <div className={destaque ? "cartao-destaque" : "cartao"}>
      <p className="flex items-center gap-1 text-xs text-zinc-500">
        {rotulo}
        {ajuda && <span title={ajuda} className="cursor-help"><Info size={12} /></span>}
      </p>
      <p className="mt-2 text-3xl font-normal tracking-tight">{valor}</p>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs">
        {variacao !== null && variacao !== undefined && (
          <span className={`flex items-center font-semibold ${bom ? "text-emerald-700" : "text-red-600"}`}>
            {variacao >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
            {pct(Math.abs(variacao))}
          </span>
        )}
        {detalhe && <span className="text-zinc-500">{detalhe}</span>}
      </div>
    </div>
  );
}

export function Secao({ id, titulo, descricao, acao, children }: { id?: string; titulo: string; descricao?: string; acao?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <h2 className="titulo-marca text-xl">{titulo}</h2>
          {descricao && <p className="text-xs text-zinc-500">{descricao}</p>}
        </div>
        {acao && <div className="ml-auto">{acao}</div>}
      </div>
      {children}
    </section>
  );
}

/** Barras horizontais (ranking, distribuicoes). */
export function Barras({ itens, formato = (v) => String(v), vazio = "Sem dados no período." }: {
  itens: { rotulo: string; valor: number; nota?: string; cor?: string }[];
  formato?: (v: number) => string;
  vazio?: string;
}) {
  const max = Math.max(0, ...itens.map((i) => valorDisponivel(i.valor) ? Math.abs(i.valor) : 0));
  if (!itens.length || max === 0) return <p className="py-3 text-sm text-zinc-500">{vazio}</p>;
  return (
    <ul className="space-y-2">
      {itens.map((i, k) => (
        <li key={i.rotulo} className="text-sm">
          <div className="flex justify-between gap-2">
            <span className="truncate">{i.rotulo}</span>
            <span className="shrink-0 font-medium">{valorDisponivel(i.valor) ? formato(i.valor) : "—"}{i.nota && <span className="ml-1 text-xs font-normal text-zinc-500">{i.nota}</span>}</span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-zinc-200">
            <div className={`h-1.5 rounded-full ${styles.barra}`} style={{ width: `${valorDisponivel(i.valor) && i.valor >= 0 ? (i.valor / max) * 100 : 0}%`, background: i.cor ?? CORES_CRM[k % CORES_CRM.length], animationDelay: `${Math.min(k, 8) * 45}ms` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Colunas verticais (serie por dia ou por hora). Valores 0..1 quando `taxa`. */
export function Colunas({ itens, taxa, formato = (v) => String(v) }: {
  itens: { rotulo: string; valor: number | null; dica?: string }[];
  taxa?: boolean;
  formato?: (v: number) => string;
}) {
  const max = taxa ? 1 : Math.max(1, ...itens.map((i) => valorDisponivel(i.valor) ? i.valor : 0));
  const poucos = itens.length <= 16;
  return (
    <div>
      <div className="flex h-32 items-end gap-[2px]">
        {itens.map((i, k) => (
          <div key={k} tabIndex={0} role="img" aria-label={`${i.dica ?? i.rotulo}: ${i.valor === null ? "fechado" : valorDisponivel(i.valor) ? formato(i.valor) : "indisponível"}`} className="group relative flex h-full flex-1 items-end outline-offset-4 focus-visible:outline-2 focus-visible:outline-ouro" title={`${i.dica ?? i.rotulo}: ${i.valor === null ? "fechado" : valorDisponivel(i.valor) ? formato(i.valor) : "indisponível"}`}>
            <span aria-hidden="true" className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-lg border border-zinc-200 bg-white px-2 py-1 text-[10px] text-zinc-900 shadow-lg group-hover:block group-focus:block group-active:block">{i.dica ?? i.rotulo}: {i.valor === null ? "fechado" : valorDisponivel(i.valor) ? formato(i.valor) : "indisponível"}</span>
            <div className={`w-full rounded-t-md ${styles.coluna}`} style={{ height: `${valorDisponivel(i.valor) ? Math.max(0, Math.min(100, i.valor / max * 100)) : 0}%`, background: CORES_CRM[0], animationDelay: `${Math.min(k, 12) * 35}ms` }} />
            {!valorDisponivel(i.valor) && <span className="absolute bottom-0 left-1/2 -translate-x-1/2 text-[10px] text-zinc-500">—</span>}
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-[2px] text-[10px] text-zinc-500">
        {itens.map((i, k) => (
          <span key={k} className="flex-1 truncate text-center">{poucos || k % Math.ceil(itens.length / 10) === 0 ? i.rotulo : ""}</span>
        ))}
      </div>
    </div>
  );
}

export function Ajuda({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] leading-4 text-zinc-500">{children}</p>;
}
