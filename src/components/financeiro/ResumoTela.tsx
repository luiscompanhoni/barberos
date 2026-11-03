"use client";

import { useCallback, useEffect, useState } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { api, reais } from "@/lib/cliente-api";
import { ROTULO_CATEGORIA } from "@/lib/financeiro/regras";
import { mesAtual } from "./DespesasTela";
import { GraficoLinhaCrm } from "@/components/visual/GraficosCrm";
import { GraficoBarrasCrm } from "@/components/visual/GraficoBarrasCrm";
import { ContadorCrm } from "@/components/visual/ContadorCrm";

type Dia = { dia: string; receita: number; despesa: number };
type Resumo = {
  mes: string;
  receitas: {
    comandas: { total: number; quantidade: number; porForma: Record<string, number>; pagoAntes: number; pagoPorLink?: number };
    mensalidades: { total: number; quantidade: number }; antecipados: { total: number; quantidade: number };
    links?: { total: number; quantidade: number }; estornos?: { total: number; quantidade: number; porForma: Record<string, number> }; total: number;
  };
  despesas: { total: number; quantidade: number; porCategoria: Record<string, number> };
  resultado: number; serie: Dia[];
  anterior: { mes: string; receitas: number; despesas: number; resultado: number };
  variacao: { receitas: number | null; despesas: number | null; resultado: number | null };
};

const COR_RECEITA = "#eca58e";
const COR_DESPESA = "#91c4e4";
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

/** Série real em centavos; valores negativos e dias sem movimento continuam visíveis. */
function Grafico({ serie }: { serie: Dia[] }) {
  return <GraficoLinhaCrm rotulo="Receita e despesa por dia do mês" rotulos={serie.map(d => d.dia.split("-").reverse().join("/"))} formatar={reais} series={[
    { nome: "Receita", cor: COR_RECEITA, valores: serie.map(d => d.receita) },
    { nome: "Despesa", cor: COR_DESPESA, valores: serie.map(d => d.despesa) },
  ]} />;
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
      <div className="crm-filterbar flex flex-wrap items-end gap-2">
        <div><label className="rotulo">Mês</label><input aria-label="Mês do resumo financeiro" type="month" className="campo" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} /></div>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="crm-kpi cartao"><p className="text-xs text-zinc-500">Receitas</p><p className="text-xl font-normal"><ContadorCrm valor={r.receitas.total} formatar={reais} /></p><Variacao v={r.variacao.receitas} /></div>
        <div className="crm-kpi cartao"><p className="text-xs text-zinc-500">Despesas pagas</p><p className="text-xl font-normal"><ContadorCrm valor={r.despesas.total} formatar={reais} /></p><Variacao v={r.variacao.despesas} inverso /></div>
        <div className="crm-kpi cartao-destaque">
          <p className="text-xs text-zinc-500">Resultado</p>
          <p className={`text-2xl font-normal ${r.resultado >= 0 ? "text-ouro" : "text-red-600"}`}><ContadorCrm valor={r.resultado} formatar={reais} /></p>
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
            {!!r.receitas.estornos?.quantidade && (
              <li className="flex justify-between py-1.5 text-red-600"><span>Estornos devolvidos ({r.receitas.estornos.quantidade})</span><b>− {reais(r.receitas.estornos.total)}</b></li>
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
            <><GraficoBarrasCrm rotulo="Despesas pagas por categoria" formatar={reais} itens={cats.map(([c, valor]) => ({ rotulo: ROTULO_CATEGORIA[c] ?? c, valor, cor: COR_DESPESA }))} /><p className="flex justify-between border-t border-zinc-200 pt-3 text-sm font-semibold"><span>Total</span><span>{reais(r.despesas.total)}</span></p></>
          )}
        </section>
      </div>
    </div>
  );
}
