"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Settings2, TriangleAlert, Undo2 } from "lucide-react";
import { api, centavosParaTexto, paraCentavos, reais } from "@/lib/cliente-api";

type Forma = "PIX" | "DEBITO" | "CREDITO" | "ONLINE";
type Linha = {
  data: string; forma: Forma; quantidade: number; brutoCentavos: number; estornoCentavos?: number; taxaCentavos: number; liquidoCentavos: number; previstoEm: string;
  recebidoCentavos: number | null; diferencaCentavos: number | null; status: "PENDENTE" | "CONFERIDO" | "DIVERGENTE"; observacao: string | null;
};
type Taxa = { forma: Forma; taxaBps: number; prazoDias: number };
type Dados = { linhas: Linha[]; totais: { bruto: number; estornos?: number; liquido: number; recebido: number; pendentes: number; divergentes: number }; taxas: Taxa[] };

const ROTULO: Record<Forma, string> = { PIX: "Pix", DEBITO: "Débito", CREDITO: "Crédito", ONLINE: "Online (Celcash)" };
const br = (d: string) => d.split("-").reverse().slice(0, 2).join("/");
const hojeSp = () => new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);
const menosDias = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() - n); return x.toISOString().slice(0, 10); };

/** Conciliacao: o que o sistema registrou x o que caiu na conta, por dia e meio de recebimento. */
export function ConciliacaoTela({ gestao }: { gestao: boolean }) {
  const [periodo, setPeriodo] = useState({ de: menosDias(hojeSp(), 14), ate: hojeSp() });
  const [d, setD] = useState<Dados | null>(null);
  const [edit, setEdit] = useState<{ chave: string; valor: string; obs: string } | null>(null);
  const [taxas, setTaxas] = useState<Taxa[] | null>(null);
  const [msg, setMsg] = useState<{ t: string; erro?: boolean } | null>(null);

  const carregar = useCallback(() => {
    api<Dados>(`/api/financeiro/conciliacao?de=${periodo.de}&ate=${periodo.ate}`).then(setD).catch((e) => setMsg({ t: e.message, erro: true }));
  }, [periodo]);
  useEffect(() => { carregar(); }, [carregar]);

  async function post(body: Record<string, unknown>, ok: string) {
    setMsg(null);
    try {
      const r = await api<unknown>("/api/financeiro/conciliacao", { method: "POST", body });
      if (body.acao === "taxas") setTaxas(null);
      setEdit(null);
      setMsg({ t: ok });
      carregar();
      return r;
    } catch (e) {
      setMsg({ t: (e as Error).message, erro: true });
    }
  }

  return (
    <div className="space-y-4">
      <section className="cartao flex flex-wrap items-end gap-3">
        <div><label className="rotulo">De</label><input type="date" className="campo" value={periodo.de} onChange={(e) => setPeriodo({ ...periodo, de: e.target.value })} /></div>
        <div><label className="rotulo">Até</label><input type="date" className="campo" value={periodo.ate} onChange={(e) => setPeriodo({ ...periodo, ate: e.target.value })} /></div>
        {d && (
          <div className="ml-auto flex flex-wrap gap-4 text-sm">
            <span>Bruto <b>{reais(d.totais.bruto)}</b></span>
            {!!d.totais.estornos && <span className="text-red-600">já descontados {reais(d.totais.estornos)} de estornos</span>}
            <span>Líquido esperado <b>{reais(d.totais.liquido)}</b></span>
            <span>Conferido <b>{reais(d.totais.recebido)}</b></span>
            {d.totais.pendentes > 0 && <span className="text-amber-700">{d.totais.pendentes} a conferir</span>}
            {d.totais.divergentes > 0 && <span className="font-bold text-red-600">{d.totais.divergentes} com diferença</span>}
          </div>
        )}
        {gestao && d && <button className="btn" onClick={() => setTaxas(taxas ? null : d.taxas)}><Settings2 size={15} /> Taxas e prazos</button>}
      </section>

      {msg && <p className={`rounded-xl p-3 text-sm ${msg.erro ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"}`}>{msg.t}</p>}

      {taxas && (
        <section className="cartao space-y-3">
          <h2 className="font-semibold">Taxas da maquininha / Celcash</h2>
          <div className="grid gap-2 sm:grid-cols-4">
            {taxas.map((t, i) => (
              <div key={t.forma} className="rounded-xl border border-zinc-200 p-3">
                <p className="mb-2 text-sm font-semibold">{ROTULO[t.forma]}</p>
                <label className="rotulo">Taxa (%)</label>
                <input className="campo" inputMode="decimal" value={(t.taxaBps / 100).toString().replace(".", ",")}
                  onChange={(e) => { const v = Math.round(Number(e.target.value.replace(",", ".")) * 100); setTaxas(taxas.map((x, j) => (j === i ? { ...x, taxaBps: Number.isFinite(v) ? v : 0 } : x))); }} />
                <label className="rotulo mt-2">Cai em (dias)</label>
                <input className="campo" type="number" min={0} value={t.prazoDias} onChange={(e) => setTaxas(taxas.map((x, j) => (j === i ? { ...x, prazoDias: Math.max(0, Number(e.target.value) || 0) } : x)))} />
              </div>
            ))}
          </div>
          <button className="btn-primario" onClick={() => post({ acao: "taxas", taxas }, "Taxas salvas.")}>Salvar taxas</button>
        </section>
      )}

      <section className="cartao overflow-x-auto">
        {!d ? <p className="text-sm text-zinc-500">Carregando…</p> : d.linhas.length === 0 ? (
          <p className="text-sm text-zinc-500">Nenhum recebimento por Pix, cartão ou online nesse período.</p>
        ) : (
          <table className="w-full min-w-[860px] text-sm [&_td]:px-2 [&_th]:px-2">
            <thead className="text-left text-[11px] uppercase tracking-wider text-zinc-500">
              <tr><th className="py-2">Dia</th><th>Forma</th><th className="text-right">Qtd</th><th className="text-right">Bruto</th><th className="text-right">Taxa</th><th className="text-right">Líquido</th><th>Cai em</th><th className="text-right">Recebido</th><th /></tr>
            </thead>
            <tbody className="divide-y divide-zinc-200">
              {d.linhas.map((l) => {
                const chave = `${l.data}|${l.forma}`;
                const editando = edit?.chave === chave;
                const valorEdit = editando ? paraCentavos(edit.valor || "0") : NaN;
                return (
                  <tr key={chave} className={l.status === "DIVERGENTE" ? "bg-red-50/40" : undefined}>
                    <td className="py-2">{br(l.data)}</td>
                    <td>{ROTULO[l.forma]}</td>
                    <td className="text-right">{l.quantidade}</td>
                    <td className="text-right">{reais(l.brutoCentavos)}{!!l.estornoCentavos && <span className="block text-[10px] text-red-600">− {reais(l.estornoCentavos)} estorno</span>}</td>
                    <td className="text-right text-zinc-500">-{reais(l.taxaCentavos)}</td>
                    <td className="text-right font-semibold">{reais(l.liquidoCentavos)}</td>
                    <td className={l.status === "PENDENTE" && l.previstoEm < hojeSp() ? "font-semibold text-amber-700" : ""}>{br(l.previstoEm)}</td>
                    <td className="text-right">
                      {editando ? (
                        <div className="flex flex-col items-end gap-1">
                          <input className="campo w-28 py-1 text-right" inputMode="decimal" autoFocus value={edit.valor} onChange={(e) => setEdit({ ...edit, valor: e.target.value })} />
                          {Number.isFinite(valorEdit) && Math.abs(valorEdit - l.liquidoCentavos) > 1 && (
                            <input className="campo w-56 py-1 text-xs" placeholder="Motivo da diferença" value={edit.obs} onChange={(e) => setEdit({ ...edit, obs: e.target.value })} />
                          )}
                        </div>
                      ) : l.recebidoCentavos === null ? <span className="text-xs text-zinc-500">a conferir</span> : (
                        <span className={l.status === "CONFERIDO" ? "font-semibold text-emerald-600" : "font-bold text-red-600"} title={l.observacao ?? undefined}>
                          {reais(l.recebidoCentavos)}
                          {l.status === "DIVERGENTE" && <span className="block text-[11px] font-normal"><TriangleAlert size={11} className="inline" /> {reais(l.diferencaCentavos!)} {l.observacao ? `· ${l.observacao}` : ""}</span>}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap pl-2 text-right">
                      {editando ? (
                        <>
                          <button className="btn py-1 text-xs" onClick={() => Number.isFinite(valorEdit) && post({ acao: "conferir", data: l.data, forma: l.forma, recebidoCentavos: valorEdit, ...(edit.obs ? { observacao: edit.obs } : {}) }, "Conferido.")}><Check size={13} /> Ok</button>
                          <button className="ml-1 text-xs text-zinc-500" onClick={() => setEdit(null)}>cancelar</button>
                        </>
                      ) : l.recebidoCentavos === null ? (
                        <button className="btn py-1 text-xs" onClick={() => setEdit({ chave, valor: centavosParaTexto(l.liquidoCentavos), obs: "" })}>Conferir</button>
                      ) : (
                        <button className="rounded p-1 text-zinc-500 hover:bg-zinc-100" title="Desfazer conferência" onClick={() => post({ acao: "desfazer", data: l.data, forma: l.forma }, "Conferência desfeita.")}><Undo2 size={14} /></button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
      <p className="text-xs text-zinc-500">
        Confira cada linha com o extrato da maquininha/Celcash: o valor vem preenchido com o líquido esperado; se cair diferente, ajuste e explique.
        Dinheiro é conferido no fechamento do caixa.
      </p>
    </div>
  );
}
