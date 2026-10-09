"use client";

import { useCallback, useEffect, useState } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { api, reais } from "@/lib/cliente-api";
import { ROTULO_CATEGORIA } from "@/lib/financeiro/regras";
import { mesAtual } from "./DespesasTela";

type Dia = { dia: string; receita: number; despesa: number };
type Resumo = {
  mes: string;
  receitas: {
    comandas: { total: number; quantidade: number; porForma: Record<string, number>; pagoAntes: number; pagoPorLink?: number };
    mensalidades: { total: number; quantidade: number }; antecipados: { total: number; quantidade: number };
    links?: { total: number; quantidade: number }; total: number;
  };
  despesas: { total: number; quantidade: number; porCategoria: Record<string, number> };
  resultado: number; serie: Dia[];
  anterior: { mes: string; receitas: number; despesas: number; resultado: number };
  variacao: { receitas: number | null; despesas: number | null; resultado: number | null };
};

// Cores fixas (tema escuro): receita em ouro, despesa em azul. Validadas para daltonismo.
const COR_RECEITA = "#b08828";
const COR_DESPESA = "#5b8def";
const FORMA: Record<string, string> = { DINHEIRO: "Dinheiro", PIX: "Pix", DEBITO: "Débito", CREDITO: "Crédito" };

function Variacao({ v, inverso }: { v: number | null; inverso?: boolean }) {
  if (v === null) return <span className="text-xs text-zinc-500">sem base no mês anterior</span>;
  const bom = inverso ? v <= 0 : v >= 0;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold ${bom ? "text-emerald-600" : "text-red-600"}`}>
      {v >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />} {v > 0 ? "+" : ""}{v.toLocaleString("pt-BR")}% vs mês anterior
    </span>
  );
}

/** Barras agrupadas receita x despesa por dia (SVG puro), com dica ao passar o mouse. */
function Grafico({ serie }: { serie: Dia[] }) {
  const [foco, setFoco] = useState<number | null>(null);
  const W = 720, H = 220, M = { t: 10, r: 8, b: 22, l: 8 };
  const max = Math.max(1, ...serie.flatMap((d) => [d.receita, d.despesa]));
  const passo = (W - M.l - M.r) / serie.length;
  const barra = Math.max(2, Math.min(9, passo / 2 - 2));
  const y = (v: number) => M.t + (H - M.t - M.b) * (1 - v / max);
  const base = H - M.b;
  // Barra com topo arredondado (4px) apoiada na base.
  const caminho = (x: number, v: number) => {
    const topo = y(v), r = Math.min(4, barra / 2, base - topo);
    return `M${x},${base}V${topo + r}Q${x},${topo} ${x + r},${topo}H${x + barra - r}Q${x + barra},${topo} ${x + barra},${topo + r}V${base}Z`;
  };
  const f = foco !== null ? serie[foco] : null;
  return (
    <div className="relative">
      <div className="mb-2 flex gap-4 text-xs text-zinc-600">
        <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: COR_RECEITA }} /> Receita</span>
        <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: COR_DESPESA }} /> Despesa</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Receita e despesa por dia do mês" onMouseLeave={() => setFoco(null)}>
        {[0.5, 1].map((p) => <line key={p} x1={M.l} x2={W - M.r} y1={y(max * p)} y2={y(max * p)} stroke="currentColor" strokeOpacity={0.08} />)}
        <line x1={M.l} x2={W - M.r} y1={base} y2={base} stroke="currentColor" strokeOpacity={0.25} />
        {serie.map((d, i) => {
          const x0 = M.l + i * passo + passo / 2;
          return (
            <g key={d.dia} onMouseEnter={() => setFoco(i)}>
              <rect x={M.l + i * passo} y={M.t} width={passo} height={H - M.t - M.b} fill={foco === i ? "currentColor" : "transparent"} fillOpacity={0.05} />
              {d.receita > 0 && <path d={caminho(x0 - barra - 1, d.receita)} fill={COR_RECEITA} />}
              {d.despesa > 0 && <path d={caminho(x0 + 1, d.despesa)} fill={COR_DESPESA} />}
              {(i === 0 || (i + 1) % 5 === 0) && <text x={x0} y={H - 6} textAnchor="middle" fontSize={10} fill="currentColor" fillOpacity={0.55}>{i + 1}</text>}
            </g>
          );
        })}
      </svg>
      {f && (
        <div className="pointer-events-none absolute right-2 top-6 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs shadow">
          <p className="font-semibold">{f.dia.split("-").reverse().join("/")}</p>
          <p>Receita {reais(f.receita)}</p>
          <p>Despesa {reais(f.despesa)}</p>
          <p className="text-zinc-500">Saldo {reais(f.receita - f.despesa)}</p>
        </div>
      )}
    </div>
  );
}

/** Resumo do mes para o dono: receitas, despesas, resultado e comparacao com o mes anterior. */
export function ResumoTela() {
  const [mes, setMes] = useState(mesAtual);
  const [r, setR] = useState<Resumo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [tabela, setTabela] = useState(false);

  const carregar = useCallback(() => api<Resumo>(`/api/financeiro/resumo?mes=${mes}`).then((x) => { setR(x); setErro(null); }).catch((e) => setErro(e.message)), [mes]);
  useEffect(() => { carregar(); }, [carregar]);

  if (erro) return <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{erro}</p>;
  if (!r) return <div className="cartao text-sm text-zinc-500">Carregando…</div>;
  const cats = Object.entries(r.despesas.porCategoria).sort((a, b) => b[1] - a[1]);
  const dias = r.serie.filter((d) => d.receita || d.despesa);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div><label className="rotulo">Mês</label><input type="month" className="campo" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} /></div>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="cartao"><p className="text-xs text-zinc-500">Receitas</p><p className="text-xl font-black">{reais(r.receitas.total)}</p><Variacao v={r.variacao.receitas} /></div>
        <div className="cartao"><p className="text-xs text-zinc-500">Despesas pagas</p><p className="text-xl font-black">{reais(r.despesas.total)}</p><Variacao v={r.variacao.despesas} inverso /></div>
        <div className="cartao-destaque">
          <p className="text-xs text-zinc-500">Resultado</p>
          <p className={`text-2xl font-black ${r.resultado >= 0 ? "text-ouro" : "text-red-600"}`}>{reais(r.resultado)}</p>
          <Variacao v={r.variacao.resultado} />
          <p className="text-[11px] text-zinc-500">Mês anterior: {reais(r.anterior.resultado)}</p>
        </div>
      </div>

      <section className="cartao">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold">Receita x despesa por dia</h2>
          <button className="text-xs text-ouro underline" onClick={() => setTabela(!tabela)}>{tabela ? "ver gráfico" : "ver em tabela"}</button>
        </div>
        {tabela ? (
          dias.length === 0 ? <p className="text-sm text-zinc-500">Sem lançamentos no mês.</p> : (
            <table className="w-full text-sm [&_td]:px-2 [&_th]:px-2">
              <thead className="text-left text-[11px] uppercase tracking-wider text-zinc-500"><tr><th className="py-1.5">Dia</th><th className="text-right">Receita</th><th className="text-right">Despesa</th><th className="text-right">Saldo</th></tr></thead>
              <tbody className="divide-y divide-zinc-200">
                {dias.map((d) => <tr key={d.dia}><td className="py-1.5">{d.dia.split("-").reverse().join("/")}</td><td className="text-right">{reais(d.receita)}</td><td className="text-right">{reais(d.despesa)}</td><td className="text-right font-semibold">{reais(d.receita - d.despesa)}</td></tr>)}
              </tbody>
            </table>
          )
        ) : <Grafico serie={r.serie} />}
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="cartao space-y-2">
          <h2 className="font-semibold">Receitas</h2>
          <ul className="divide-y divide-zinc-200 text-sm">
            <li className="flex justify-between py-1.5"><span>Comandas fechadas ({r.receitas.comandas.quantidade})</span><b>{reais(r.receitas.comandas.total)}</b></li>
            {Object.entries(r.receitas.comandas.porForma).map(([k, v]) => (
              <li key={k} className="flex justify-between py-1 pl-4 text-xs text-zinc-500"><span>{FORMA[k] ?? k}{k === "DINHEIRO" ? " (já sem o troco)" : ""}</span><span>{reais(v)}</span></li>
            ))}
            <li className="flex justify-between py-1.5"><span>Mensalidades pagas online ({r.receitas.mensalidades.quantidade})</span><b>{reais(r.receitas.mensalidades.total)}</b></li>
            <li className="flex justify-between py-1.5"><span>Pagamentos antecipados ({r.receitas.antecipados.quantidade})</span><b>{reais(r.receitas.antecipados.total)}</b></li>
            {!!r.receitas.links?.quantidade && (
              <li className="flex justify-between py-1.5"><span>Links de pagamento ({r.receitas.links.quantidade})</span><b>{reais(r.receitas.links.total)}</b></li>
            )}
            <li className="flex justify-between py-1.5 font-black"><span>Total</span><span>{reais(r.receitas.total)}</span></li>
          </ul>
          {r.receitas.comandas.pagoAntes > 0 && (
            <p className="text-[11px] text-zinc-500">{reais(r.receitas.comandas.pagoAntes)} das comandas foram pagos antes pelo link e estão contados em “pagamentos antecipados”, na data em que o cliente pagou.</p>
          )}
          {!!r.receitas.comandas.pagoPorLink && (
            <p className="text-[11px] text-zinc-500">{reais(r.receitas.comandas.pagoPorLink)} das comandas foram pagos por link de pagamento e estão contados em “links de pagamento”, na data do pagamento.</p>
          )}
        </section>
        <section className="cartao space-y-2">
          <h2 className="font-semibold">Despesas pagas por categoria</h2>
          {cats.length === 0 ? <p className="text-sm text-zinc-500">Nenhuma despesa paga no mês.</p> : (
            <ul className="divide-y divide-zinc-200 text-sm">
              {cats.map(([c, v]) => (
                <li key={c} className="py-1.5">
                  <div className="flex justify-between"><span>{ROTULO_CATEGORIA[c] ?? c}</span><b>{reais(v)}</b></div>
                  <div className="mt-1 h-1.5 rounded-full bg-zinc-100"><div className="h-1.5 rounded-full" style={{ width: `${(v / r.despesas.total) * 100}%`, background: COR_DESPESA }} /></div>
                </li>
              ))}
              <li className="flex justify-between py-1.5 font-black"><span>Total</span><span>{reais(r.despesas.total)}</span></li>
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
