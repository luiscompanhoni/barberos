"use client";

import { useCallback, useEffect, useState } from "react";
import { CircleCheck, Pencil, Plus, Repeat, RotateCcw, Trash2, TriangleAlert } from "lucide-react";
import { api, centavosParaTexto, paraCentavos, reais } from "@/lib/cliente-api";
import { CATEGORIAS_DESPESA, FORMAS_DESPESA, ROTULO_CATEGORIA, ROTULO_FORMA_DESPESA } from "@/lib/financeiro/regras";

type Despesa = {
  id: string; descricao: string; categoria: string; valorCentavos: number; vencimento: string; status: "PENDENTE" | "PAGA"; pagoEm: string | null;
  pagoEmLocal: string | null; formaPagamento: string | null; fornecedor: string | null; observacao: string | null; recorrente: boolean;
  situacao: "PAGA" | "VENCIDA" | "ABERTA";
};
type Lista = {
  hoje: string; mes: string; despesas: Despesa[];
  totais: { aPagar: number; vencidas: number; qtdVencidas: number; pagasNoMes: number; porCategoria: Record<string, { aberto: number; pago: number }> };
};
type Form = { id?: string; descricao: string; categoria: string; valor: string; vencimento: string; fornecedor: string; observacao: string; recorrente: boolean };
type Filtro = "abertas" | "vencidas" | "pagas" | "todas";

export const mesAtual = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 7);
const dataBR = (d: string) => d.split("-").reverse().join("/");
const FILTROS: { k: Filtro; r: string }[] = [{ k: "abertas", r: "Abertas" }, { k: "vencidas", r: "Vencidas" }, { k: "pagas", r: "Pagas no mês" }, { k: "todas", r: "Todas" }];

/** Contas a pagar: cadastro, filtros, pagar (inclusive com dinheiro do caixa), editar, excluir e estornar. */
export function DespesasTela() {
  const [mes, setMes] = useState(mesAtual);
  const [l, setL] = useState<Lista | null>(null);
  const [msg, setMsg] = useState<{ t: string; erro?: boolean } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [filtro, setFiltro] = useState<Filtro>("abertas");
  const [categoria, setCategoria] = useState("");
  const [form, setForm] = useState<Form | null>(null);
  const [pagar, setPagar] = useState<{ id: string; forma: string; data: string } | null>(null);

  const carregar = useCallback(() => api<Lista>(`/api/financeiro/despesas?mes=${mes}`).then(setL).catch((e) => setMsg({ t: e.message, erro: true })), [mes]);
  useEffect(() => { carregar(); }, [carregar]);

  async function agir(fn: () => Promise<unknown>, ok: string) {
    setMsg(null);
    setOcupado(true);
    try {
      await fn();
      setMsg({ t: ok });
      setForm(null);
      setPagar(null);
      await carregar();
    } catch (e) {
      setMsg({ t: (e as Error).message, erro: true });
    } finally {
      setOcupado(false);
    }
  }

  function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    const v = paraCentavos(form.valor);
    if (!(v > 0)) return setMsg({ t: "Informe o valor.", erro: true });
    if (!form.vencimento) return setMsg({ t: "Informe o vencimento.", erro: true });
    const body = { descricao: form.descricao, categoria: form.categoria, valorCentavos: v, vencimento: form.vencimento, fornecedor: form.fornecedor || null, observacao: form.observacao || null, recorrente: form.recorrente };
    agir(
      () => (form.id ? api(`/api/financeiro/despesas/${form.id}`, { method: "PATCH", body: { acao: "editar", ...body } }) : api("/api/financeiro/despesas", { method: "POST", body })),
      form.id ? "Despesa atualizada." : "Despesa cadastrada.",
    );
  }

  if (!l) return <div className="cartao text-sm text-zinc-500">{msg?.t ?? "Carregando…"}</div>;
  const visiveis = l.despesas.filter((d) =>
    (filtro === "todas" || (filtro === "abertas" ? d.status === "PENDENTE" : filtro === "vencidas" ? d.situacao === "VENCIDA" : d.status === "PAGA"))
    && (!categoria || d.categoria === categoria));
  const cats = Object.entries(l.totais.porCategoria).sort((a, b) => b[1].aberto + b[1].pago - (a[1].aberto + a[1].pago));

  return (
    <div className="space-y-4">
      {msg && <p className={`rounded-xl p-3 text-sm ${msg.erro ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"}`}>{msg.t}</p>}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="cartao"><p className="text-xs text-zinc-500">A pagar (em aberto)</p><p className="text-xl font-black">{reais(l.totais.aPagar)}</p></div>
        <div className={l.totais.vencidas ? "cartao border-red-300" : "cartao"}>
          <p className="flex items-center gap-1 text-xs text-zinc-500">{l.totais.vencidas > 0 && <TriangleAlert size={13} className="text-red-600" />} Vencidas</p>
          <p className={`text-xl font-black ${l.totais.vencidas ? "text-red-600" : ""}`}>{reais(l.totais.vencidas)} <span className="text-xs font-normal text-zinc-500">({l.totais.qtdVencidas})</span></p>
        </div>
        <div className="cartao"><p className="text-xs text-zinc-500">Pagas no mês</p><p className="text-xl font-black text-ouro">{reais(l.totais.pagasNoMes)}</p></div>
      </div>

      <section className="cartao space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="rotulo">Mês (pagas)</label>
            <input type="month" className="campo" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} />
          </div>
          <div>
            <label className="rotulo">Categoria</label>
            <select className="campo" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
              <option value="">Todas</option>
              {CATEGORIAS_DESPESA.map((c) => <option key={c} value={c}>{ROTULO_CATEGORIA[c]}</option>)}
            </select>
          </div>
          <button className="btn-primario ml-auto" onClick={() => setForm({ descricao: "", categoria: "OUTROS", valor: "", vencimento: l.hoje, fornecedor: "", observacao: "", recorrente: false })}><Plus size={15} /> Nova despesa</button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {FILTROS.map((f) => (
            <button key={f.k} className={`rounded-full border px-3 py-1 text-xs ${filtro === f.k ? "border-ouro bg-ouro/15 font-semibold text-ouro" : "border-zinc-200 text-zinc-600"}`} onClick={() => setFiltro(f.k)}>
              {f.r}{f.k === "vencidas" && l.totais.qtdVencidas ? ` (${l.totais.qtdVencidas})` : ""}
            </button>
          ))}
        </div>

        {form && (
          <form className="grid gap-2 rounded-xl border border-zinc-200 p-3 sm:grid-cols-2" onSubmit={salvar}>
            <div className="sm:col-span-2"><label className="rotulo">Descrição</label><input className="campo w-full" value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} placeholder="Ex.: Aluguel do salão" autoFocus required minLength={2} /></div>
            <div><label className="rotulo">Categoria</label>
              <select className="campo w-full" value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })}>
                {CATEGORIAS_DESPESA.map((c) => <option key={c} value={c}>{ROTULO_CATEGORIA[c]}</option>)}
              </select>
            </div>
            <div><label className="rotulo">Valor</label><input className="campo w-full" inputMode="decimal" placeholder="0,00" value={form.valor} onChange={(e) => setForm({ ...form, valor: e.target.value })} /></div>
            <div><label className="rotulo">Vencimento</label><input type="date" className="campo w-full" value={form.vencimento} onChange={(e) => setForm({ ...form, vencimento: e.target.value })} /></div>
            <div><label className="rotulo">Fornecedor (opcional)</label><input className="campo w-full" value={form.fornecedor} onChange={(e) => setForm({ ...form, fornecedor: e.target.value })} /></div>
            <div className="sm:col-span-2"><label className="rotulo">Observação (opcional)</label><input className="campo w-full" value={form.observacao} onChange={(e) => setForm({ ...form, observacao: e.target.value })} /></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.recorrente} onChange={(e) => setForm({ ...form, recorrente: e.target.checked })} /> Repete todo mês</label>
            <div className="flex justify-end gap-2"><button className="btn-primario" disabled={ocupado}>Salvar</button><button type="button" className="btn" onClick={() => setForm(null)}>Cancelar</button></div>
          </form>
        )}

        {visiveis.length === 0 ? <p className="text-sm text-zinc-500">Nenhuma despesa aqui.</p> : (
          <ul className="divide-y divide-zinc-200">
            {visiveis.map((d) => (
              <li key={d.id} className={`py-2.5 ${d.situacao === "VENCIDA" ? "-mx-2 rounded-lg bg-red-50 px-2" : ""}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 font-semibold">
                      {d.descricao} {d.recorrente && <Repeat size={13} className="text-zinc-500" aria-label="Repete todo mês" />}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {ROTULO_CATEGORIA[d.categoria] ?? d.categoria}{d.fornecedor ? ` · ${d.fornecedor}` : ""} ·{" "}
                      {d.status === "PAGA"
                        ? `paga em ${dataBR(d.pagoEmLocal ?? "")}${d.formaPagamento ? ` (${ROTULO_FORMA_DESPESA[d.formaPagamento] ?? d.formaPagamento})` : ""}`
                        : <span className={d.situacao === "VENCIDA" ? "font-semibold text-red-700" : ""}>{d.situacao === "VENCIDA" ? "venceu" : "vence"} {dataBR(d.vencimento)}</span>}
                      {d.observacao ? ` · ${d.observacao}` : ""}
                    </p>
                  </div>
                  <b className={d.status === "PAGA" ? "text-emerald-600" : ""}>{reais(d.valorCentavos)}</b>
                  <div className="flex gap-1">
                    {d.status === "PENDENTE" ? (
                      <>
                        <button className="btn-primario px-3 py-1 text-xs" onClick={() => setPagar({ id: d.id, forma: "PIX", data: l.hoje })}><CircleCheck size={14} /> Pagar</button>
                        <button className="btn px-2 py-1" title="Editar" onClick={() => setForm({ id: d.id, descricao: d.descricao, categoria: d.categoria, valor: centavosParaTexto(d.valorCentavos), vencimento: d.vencimento, fornecedor: d.fornecedor ?? "", observacao: d.observacao ?? "", recorrente: d.recorrente })}><Pencil size={14} /></button>
                        <button className="btn px-2 py-1" title="Excluir" disabled={ocupado} onClick={() => confirm(`Excluir "${d.descricao}"?`) && agir(() => api(`/api/financeiro/despesas/${d.id}`, { method: "DELETE" }), "Despesa excluída.")}><Trash2 size={14} /></button>
                      </>
                    ) : (
                      <button className="btn px-3 py-1 text-xs" disabled={ocupado} onClick={() => confirm(`Estornar o pagamento de "${d.descricao}"? Ela volta para em aberto.`) && agir(() => api(`/api/financeiro/despesas/${d.id}`, { method: "PATCH", body: { acao: "estornar" } }), "Pagamento estornado.")}><RotateCcw size={14} /> Estornar</button>
                    )}
                  </div>
                </div>
                {pagar?.id === d.id && (
                  <form className="mt-2 flex flex-wrap items-end gap-2 rounded-xl border border-zinc-200 p-3" onSubmit={(e) => { e.preventDefault(); agir(() => api(`/api/financeiro/despesas/${d.id}`, { method: "PATCH", body: { acao: "pagar", forma: pagar.forma, data: pagar.data } }), d.recorrente ? "Despesa paga. A do mês que vem já foi lançada." : "Despesa paga."); }}>
                    <div><label className="rotulo">Forma</label>
                      <select className="campo" value={pagar.forma} onChange={(e) => setPagar({ ...pagar, forma: e.target.value })}>
                        {FORMAS_DESPESA.map((f) => <option key={f} value={f}>{ROTULO_FORMA_DESPESA[f]}</option>)}
                      </select>
                    </div>
                    {pagar.forma === "DINHEIRO_CAIXA" ? <p className="pb-2 text-xs text-zinc-500">Sai agora do caixa aberto, como sangria.</p> : (
                      <div><label className="rotulo">Data do pagamento</label><input type="date" className="campo" max={l.hoje} value={pagar.data} onChange={(e) => setPagar({ ...pagar, data: e.target.value })} /></div>
                    )}
                    <button className="btn-primario" disabled={ocupado}>Confirmar pagamento</button>
                    <button type="button" className="btn" onClick={() => setPagar(null)}>Cancelar</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {cats.length > 0 && (
        <section className="cartao">
          <h2 className="mb-2 font-semibold">Por categoria</h2>
          <table className="w-full text-sm [&_td]:px-2 [&_th]:px-2">
            <thead className="text-left text-[11px] uppercase tracking-wider text-zinc-500"><tr><th className="py-1.5">Categoria</th><th className="text-right">Em aberto</th><th className="text-right">Pago no mês</th></tr></thead>
            <tbody className="divide-y divide-zinc-200">
              {cats.map(([c, v]) => (
                <tr key={c} className="cursor-pointer hover:bg-zinc-50" onClick={() => { setCategoria(c); setFiltro("todas"); }}>
                  <td className="py-1.5">{ROTULO_CATEGORIA[c] ?? c}</td><td className="text-right">{reais(v.aberto)}</td><td className="text-right font-semibold">{reais(v.pago)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
