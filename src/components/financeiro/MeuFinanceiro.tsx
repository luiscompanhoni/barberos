"use client";
import { useCallback, useEffect, useState } from "react";
import { api, paraCentavos, reais } from "@/lib/cliente-api";
type Item = { id: string; tipo: string; descricao: string; categoria: string; valorCentavos: number; data: string; realizado: boolean };
type Painel = { itens: Item[]; resumo: { receitas: number; despesas: number; saldo: number; projetado: number; categorias: Record<string, number> } };
const hoje = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
export function MeuFinanceiro() {
  const [mes, setMes] = useState(() => hoje().slice(0, 7));
  const [p, setP] = useState<Painel | null>(null), [msg, setMsg] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [ultimoAnulado, setUltimoAnulado] = useState<string | null>(null);
  const carregar = useCallback(() => api<Painel>(`/api/meu-financeiro?mes=${mes}`).then(setP).catch(e => setMsg(e.message)), [mes]);
  useEffect(() => { carregar(); }, [carregar]);
  async function salvar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); const form = e.currentTarget; const f = new FormData(form); setOcupado(true); setMsg("");
    try {
      await api("/api/meu-financeiro", { method: "POST", body: { tipo: f.get("tipo"), descricao: f.get("descricao"), categoria: f.get("categoria"), valorCentavos: paraCentavos(String(f.get("valor"))), data: f.get("data"), realizado: f.get("realizado") === "on" } });
      form.reset(); await carregar(); setMsg("Lançamento salvo no seu controle pessoal.");
    } catch (e) { setMsg((e as Error).message); } finally { setOcupado(false); }
  }
  const maior = p && Object.entries(p.resumo.categorias).sort((a,b) => b[1]-a[1])[0];
  async function anular(id: string, anulado: boolean) {
    setOcupado(true);
    try { await api("/api/meu-financeiro", { method: "PATCH", body: { id, anulado } }); setUltimoAnulado(anulado ? id : null); await carregar(); }
    catch (e) { setMsg((e as Error).message); } finally { setOcupado(false); }
  }
  return <div className="space-y-5">
    <header className="cabecalho-gestao"><div><p className="eyebrow">Seu dinheiro</p><h1 className="titulo-marca text-3xl">Meu financeiro</h1><p className="mt-2 text-sm text-zinc-600">Receitas e despesas pessoais. Apenas você acessa estes lançamentos.</p></div><label className="rotulo">Mês<input className="campo" aria-label="Mês do financeiro pessoal" type="month" value={mes} onChange={e => setMes(e.target.value)} required /></label></header>
    {msg && <p role="status" className="cartao text-sm">{msg}</p>}
    {ultimoAnulado && <p role="status" className="flex items-center gap-3 text-sm">Lançamento anulado.<button className="btn" disabled={ocupado} onClick={() => anular(ultimoAnulado, false)}>Desfazer</button></p>}
    {p && <><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[["Receitas recebidas",p.resumo.receitas],["Despesas pagas",p.resumo.despesas],["Sobrou no mês",p.resumo.saldo],["Saldo projetado",p.resumo.projetado]].map(([n,v]) => <div className="cartao" key={n}><p className="text-xs text-zinc-600">{n}</p><p className="mt-2 text-xl font-bold">{reais(Number(v))}</p></div>)}</div>
      <section className="cartao space-y-2"><h2 className="font-semibold">Leitura do mês</h2><p className="text-sm text-zinc-600">{p.itens.length === 0 ? "Comece registrando suas receitas e despesas para acompanhar o que sobra." : p.resumo.despesas > p.resumo.receitas ? "As despesas pagas superam as receitas registradas. Revise os gastos e confira se todas as entradas foram lançadas." : "O saldo dos lançamentos realizados está positivo ou equilibrado. Reserve uma parte antes de assumir novos gastos."}</p>{maior && <p className="text-sm">Maior categoria de gasto: <b>{maior[0]}</b>, {reais(maior[1])}. Confira os itens antes de decidir onde economizar.</p>}<p className="text-xs text-zinc-500">Projeção = saldo realizado + receitas previstas − despesas previstas. Não inclui contas ainda não registradas.</p></section></>}
    <form onSubmit={salvar} className="cartao grid gap-3 sm:grid-cols-2"><h2 className="font-semibold sm:col-span-2">Novo lançamento</h2>
      <label className="rotulo">Tipo<select name="tipo" className="campo"><option value="RECEITA">Receita</option><option value="DESPESA">Despesa</option></select></label>
      <label className="rotulo">Valor<input name="valor" className="campo" inputMode="decimal" placeholder="0,00" required /></label>
      <label className="rotulo">Descrição<input name="descricao" className="campo" minLength={2} maxLength={150} required /></label>
      <label className="rotulo">Categoria<input name="categoria" className="campo" placeholder="Moradia, alimentação, comissão…" minLength={2} maxLength={60} required /></label>
      <label className="rotulo">Data<input name="data" type="date" className="campo" defaultValue={hoje()} required /></label>
      <label className="flex items-center gap-2 text-sm"><input name="realizado" type="checkbox" defaultChecked /> Já foi recebido ou pago</label>
      <button className="btn-primario sm:col-span-2" disabled={ocupado}>Salvar lançamento</button>
    </form>
    <section className="cartao"><h2 className="mb-3 font-semibold">Movimentações do mês</h2>{p?.itens.length === 0 && <p className="text-sm text-zinc-500">Nenhum lançamento neste mês.</p>}<ul className="divide-y divide-zinc-200">{p?.itens.map(i => <li key={i.id} className="flex flex-wrap justify-between gap-3 py-3 text-sm"><div><b>{i.descricao}</b><p className="text-xs text-zinc-500">{i.data.slice(0,10).split("-").reverse().join("/")} · {i.categoria} · {i.realizado ? "Realizado" : "Previsto"}</p></div><div className="flex items-center gap-3"><span className={i.tipo === "RECEITA" ? "text-emerald-600" : "text-red-600"}>{i.tipo === "RECEITA" ? "+" : "−"}{reais(i.valorCentavos)}</span><button type="button" className="btn" disabled={ocupado} onClick={() => anular(i.id,true)} aria-label={`Anular lançamento ${i.descricao}`}>Anular</button></div></li>)}</ul></section>
    <section className="cartao"><h2 className="font-semibold">Contas e cartões</h2><p className="mt-2 text-sm text-zinc-600">Integração bancária em preparação. Por enquanto, os lançamentos são manuais; nenhuma conta ou cartão está conectado.</p></section>
  </div>;
}
