"use client";

import { useEffect, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { api, centavosParaTexto, paraCentavos } from "@/lib/cliente-api";

type Categoria = "BAR" | "LOJA";
type Dados = {
  pote: {
    ativo: boolean; percentualBps: number;
    fichas: { servicoId: string; nome: string; fichas: number }[];
    ajustes: { barbeiroId: string; nome: string; adicionalBps: number; diferenciadaBps: number | null }[];
  };
  faixas: { categoria: Categoria; minimoCentavos: number; percentualBps: number }[];
};
// No formulario: percentuais como texto ("35", "5,5") e valores em reais ("100,00").
type Form = {
  ativo: boolean; percentual: string;
  fichas: Record<string, string>;
  ajustes: Record<string, { adicional: string; diferenciada: string }>;
  faixas: { chave: number; categoria: Categoria; minimo: string; percentual: string }[];
};

const ROTULO: Record<Categoria, string> = { LOJA: "Loja (produtos)", BAR: "Conveniência (bar)" };
const pctTexto = (bps: number) => String(bps / 100).replace(".", ",");
const pctValor = (s: string) => Math.round(Number((s || "0").replace(",", ".")) * 100);
let seq = 0;

function paraForm(d: Dados): Form {
  return {
    ativo: d.pote.ativo, percentual: pctTexto(d.pote.percentualBps),
    fichas: Object.fromEntries(d.pote.fichas.map((f) => [f.servicoId, String(f.fichas)])),
    ajustes: Object.fromEntries(d.pote.ajustes.map((a) => [a.barbeiroId, { adicional: a.adicionalBps ? pctTexto(a.adicionalBps) : "", diferenciada: a.diferenciadaBps === null ? "" : pctTexto(a.diferenciadaBps) }])),
    faixas: d.faixas.map((f) => ({ chave: ++seq, categoria: f.categoria, minimo: centavosParaTexto(f.minimoCentavos), percentual: pctTexto(f.percentualBps) })),
  };
}

/** Pote de assinaturas (como o Dpote do CashBarber) e comissao de produtos por faixa de venda. */
export function ComissoesExtras() {
  const [d, setD] = useState<Dados | null>(null);
  const [f, setF] = useState<Form | null>(null);
  const [msg, setMsg] = useState<{ t: string; erro?: boolean } | null>(null);
  const [salvando, setSalvando] = useState(false);

  const aplicar = (x: Dados) => { setD(x); setF(paraForm(x)); };
  useEffect(() => { api<Dados>("/api/rh/comissoes/extras").then(aplicar).catch((e) => setMsg({ t: e.message, erro: true })); }, []);

  async function salvar() {
    if (!d || !f) return;
    const body = {
      pote: {
        ativo: f.ativo, percentualBps: pctValor(f.percentual),
        fichas: d.pote.fichas.map((s) => ({ servicoId: s.servicoId, fichas: Math.round(Number(f.fichas[s.servicoId] || "0")) })),
        ajustes: d.pote.ajustes.map((a) => {
          const x = f.ajustes[a.barbeiroId];
          return { barbeiroId: a.barbeiroId, adicionalBps: pctValor(x?.adicional ?? ""), diferenciadaBps: x?.diferenciada?.trim() ? pctValor(x.diferenciada) : null };
        }),
      },
      faixas: f.faixas.map((x) => ({ categoria: x.categoria, minimoCentavos: paraCentavos(x.minimo || "0"), percentualBps: pctValor(x.percentual) })),
    };
    const nums = [body.pote.percentualBps, ...body.pote.fichas.map((x) => x.fichas), ...body.pote.ajustes.flatMap((a) => [a.adicionalBps, a.diferenciadaBps ?? 0]), ...body.faixas.flatMap((x) => [x.minimoCentavos, x.percentualBps])];
    if (nums.some((n) => !Number.isFinite(n) || n < 0)) return setMsg({ t: "Confira os valores: tem campo inválido.", erro: true });
    setSalvando(true);
    setMsg(null);
    try {
      aplicar(await api<Dados>("/api/rh/comissoes/extras", { method: "PUT", body }));
      setMsg({ t: "Pote e comissão de produtos salvos." });
    } catch (e) {
      setMsg({ t: (e as Error).message, erro: true });
    } finally {
      setSalvando(false);
    }
  }

  if (!d || !f) return <div className="cartao text-sm text-zinc-500">{msg?.t ?? "Carregando…"}</div>;
  const muda = (x: Partial<Form>) => setF({ ...f, ...x });
  return (
    <div className="space-y-4">
      {msg && <p className={`rounded-xl p-3 text-sm ${msg.erro ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"}`}>{msg.t}</p>}

      <section className="cartao space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-semibold">Pote de assinaturas</h2>
          <label className="ml-auto flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.ativo} onChange={(e) => muda({ ativo: e.target.checked })} /> Ligado
          </label>
        </div>
        <p className="text-xs text-zinc-500">
          No período, <b>{f.percentual || "0"}%</b> do que entrou de mensalidades vira o pote. Ele é dividido entre os barbeiros pelas fichas dos
          atendimentos feitos pelo plano (ex.: corte 40, barba 20). Ligado, o pote substitui a coluna “Pelo plano” das regras acima.
        </p>
        <div className="flex items-center gap-2">
          <label className="rotulo m-0">% do faturamento de assinaturas</label>
          <input className="campo w-20 py-1.5 text-right" inputMode="decimal" value={f.percentual} onChange={(e) => muda({ percentual: e.target.value })} />
        </div>
        <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
          {d.pote.fichas.map((s) => (
            <label key={s.servicoId} className="flex items-center justify-between gap-2 border-t border-zinc-200 py-1 text-sm">
              <span>{s.nome}</span>
              <span className="flex items-center gap-1">
                <input className="campo w-16 py-1 text-right" inputMode="numeric" value={f.fichas[s.servicoId] ?? "0"} onChange={(e) => muda({ fichas: { ...f.fichas, [s.servicoId]: e.target.value.replace(/\D/g, "") } })} />
                <span className="text-xs text-zinc-500">fichas</span>
              </span>
            </label>
          ))}
        </div>
        <h3 className="pt-2 text-sm font-semibold">Ajuste por barbeiro (opcional)</h3>
        <p className="text-xs text-zinc-500">Adicional: soma ao % do pote (ex.: 35% + 5% = 40%). Diferenciada: usa esse % no lugar do pote. Em branco = sem ajuste.</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
            <thead><tr className="text-left text-xs text-zinc-500"><th className="py-1">Barbeiro</th><th>Adicional (%)</th><th>Diferenciada (%)</th></tr></thead>
            <tbody>
              {d.pote.ajustes.map((a) => {
                const x = f.ajustes[a.barbeiroId] ?? { adicional: "", diferenciada: "" };
                const set = (y: Partial<typeof x>) => muda({ ajustes: { ...f.ajustes, [a.barbeiroId]: { ...x, ...y } } });
                return (
                  <tr key={a.barbeiroId} className="border-t border-zinc-200">
                    <td className="py-1.5 font-medium">{a.nome}</td>
                    <td><input className="campo w-20 py-1 text-right" inputMode="decimal" value={x.adicional} onChange={(e) => set({ adicional: e.target.value })} /></td>
                    <td><input className="campo w-20 py-1 text-right" inputMode="decimal" value={x.diferenciada} onChange={(e) => set({ diferenciada: e.target.value })} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="cartao space-y-3">
        <h2 className="font-semibold">Comissão de produtos</h2>
        <p className="text-xs text-zinc-500">
          Por faixa do que o barbeiro vendeu no período em cada categoria. Vale a maior faixa alcançada, sobre tudo o que ele vendeu
          (ex.: vendeu R$ 450 na loja → 10% de R$ 450). Abaixo da primeira faixa, não ganha.
        </p>
        {(["LOJA", "BAR"] as const).map((cat) => (
          <div key={cat} className="space-y-1">
            <h3 className="text-sm font-semibold">{ROTULO[cat]}</h3>
            {f.faixas.filter((x) => x.categoria === cat).map((x) => (
              <div key={x.chave} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-xs text-zinc-500">a partir de R$</span>
                <input className="campo w-24 py-1 text-right" inputMode="decimal" value={x.minimo} onChange={(e) => muda({ faixas: f.faixas.map((y) => (y.chave === x.chave ? { ...y, minimo: e.target.value } : y)) })} />
                <input className="campo w-16 py-1 text-right" inputMode="decimal" value={x.percentual} onChange={(e) => muda({ faixas: f.faixas.map((y) => (y.chave === x.chave ? { ...y, percentual: e.target.value } : y)) })} />
                <span className="text-xs text-zinc-500">%</span>
                <button className="rounded p-1 text-zinc-500 hover:bg-red-50 hover:text-red-600" title="Remover faixa" onClick={() => muda({ faixas: f.faixas.filter((y) => y.chave !== x.chave) })}><Trash2 size={14} /></button>
              </div>
            ))}
            <button className="btn py-1 text-xs" onClick={() => muda({ faixas: [...f.faixas, { chave: ++seq, categoria: cat, minimo: "", percentual: "" }] })}><Plus size={13} /> Faixa</button>
          </div>
        ))}
      </section>

      <button className="btn-primario" disabled={salvando} onClick={salvar}><Save size={16} /> {salvando ? "Salvando…" : "Salvar pote e produtos"}</button>
    </div>
  );
}
