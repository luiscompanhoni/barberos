"use client";
import { useCallback, useEffect, useState } from "react";
import { Dices } from "lucide-react";
import { api, paraCentavos, reais } from "@/lib/cliente-api";
type Campanha = { id: string; nome: string; inicio: string; fim: string; metaQuantidade: number; metaCentavos: number; premios: number[]; rodadasDisponiveis: number; vendas: { quantidade: number; receita: number; ciclos: number } | null; bonus: { id: string; barbeiroId: string; ciclo: number; valorCentavos: number; pagoEm: string | null; nomeBarbeiro: string | null }[] };
export function CampanhasEquipe({ gestao, barbeiro }: { gestao: boolean; barbeiro: boolean }) {
  const [cs, setCs] = useState<Campanha[]>([]), [msg, setMsg] = useState(""), [ocupado, setOcupado] = useState(false);
  const carregar = useCallback(() => api<Campanha[]>("/api/campanhas-equipe").then(setCs).catch(e => setMsg(e.message)), []);
  useEffect(() => { carregar(); }, [carregar]);
  async function criar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); const form = e.currentTarget, f = new FormData(form); setOcupado(true); setMsg("");
    try { await api("/api/campanhas-equipe", { method: "POST", body: { acao: "criar", nome: f.get("nome"), inicio: new Date(String(f.get("inicio"))).toISOString(), fim: new Date(String(f.get("fim"))).toISOString(), metaQuantidade: Number(f.get("quantidade")), metaCentavos: paraCentavos(String(f.get("receita"))), premios: String(f.get("premios")).split(";").map(paraCentavos) } }); form.reset(); await carregar(); setMsg("Campanha criada. As regras ficam fixas para preservar as rodadas conquistadas."); }
    catch(e) { setMsg((e as Error).message); } finally { setOcupado(false); }
  }
  async function girar(campanhaId: string) {
    setOcupado(true); setMsg("");
    try { const r = await api<{ valorCentavos: number }>("/api/campanhas-equipe", { method: "POST", body: { acao: "girar", campanhaId } }); setMsg(`Você ganhou ${reais(r.valorCentavos)} de bônus! Registrado para conferência e pagamento pela gestão.`); await carregar(); }
    catch(e) { setMsg((e as Error).message); } finally { setOcupado(false); }
  }
  return <div className="space-y-5"><header className="cabecalho-gestao"><div><p className="eyebrow">Reconhecimento da equipe</p><h1 className="titulo-marca text-3xl">Campanhas e bônus</h1><p className="mt-2 text-sm text-zinc-600">Venda, complete as metas e libere sua rodada. Bônus adicional à comissão.</p></div></header>
    {msg && <p role="status" className="cartao-destaque">{msg}</p>}
    <p className="text-sm text-zinc-600">Contam produtos com vendedor identificado em comandas fechadas e pagas dentro do período. Descontos reduzem o valor elegível. Comandas com estorno ficam fora da apuração e exigem conferência. As metas de quantidade e valor precisam ser atingidas juntas em cada ciclo.</p>
    {gestao && <form className="cartao grid gap-3 sm:grid-cols-2" onSubmit={criar}><h2 className="font-semibold sm:col-span-2">Criar campanha</h2>
      <label className="rotulo sm:col-span-2">Nome<input name="nome" className="campo" minLength={3} maxLength={100} required /></label>
      <label className="rotulo">Início (horário deste aparelho)<input name="inicio" type="datetime-local" className="campo" required /></label><label className="rotulo">Fim (horário deste aparelho)<input name="fim" type="datetime-local" className="campo" required /></label>
      <label className="rotulo">Produtos por rodada<input name="quantidade" type="number" className="campo" min={1} max={10000} defaultValue={10} required /></label>
      <label className="rotulo">Valor vendido por rodada (R$)<input name="receita" inputMode="decimal" className="campo" defaultValue="300,00" required /></label>
      <label className="rotulo sm:col-span-2">Bônus possíveis em R$ (separados por ponto e vírgula)<input name="premios" className="campo" defaultValue="5; 10; 30; 50" required /><span className="text-xs text-zinc-500">Cada posição tem a mesma chance. Com quatro posições, 25% cada. Valores repetidos aumentam a chance daquele valor. Nenhum pagamento é feito automaticamente.</span></label>
      <button className="btn-primario sm:col-span-2" disabled={ocupado}>Criar campanha com estas regras</button>
    </form>}
    {cs.length === 0 && <p className="cartao text-sm text-zinc-500">Nenhuma campanha criada ainda.</p>}
    {cs.map(c => <section key={c.id} className="cartao-destaque space-y-4"><div><h2 className="text-xl font-bold">{c.nome}</h2><p className="text-xs text-zinc-500">{new Date(c.inicio).toLocaleString("pt-BR")} até {new Date(c.fim).toLocaleString("pt-BR")}</p></div>
      <p className="text-sm">Uma rodada a cada <b>{c.metaQuantidade} produtos</b>{c.metaCentavos > 0 && <> e <b>{reais(c.metaCentavos)}</b> em vendas elegíveis</>}.</p>
      <div className="flex flex-wrap gap-2">{c.premios.map((p,i) => <span key={i} className="rounded-xl border border-ouro/30 bg-ouro/10 px-3 py-2 text-sm text-ouro">{reais(p)} · {(100/c.premios.length).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</span>)}</div>
      {c.vendas && <><div className="grid grid-cols-2 gap-3 text-sm"><p>Seus produtos: <b>{c.vendas.quantidade}</b></p><p>Suas vendas: <b>{reais(c.vendas.receita)}</b></p></div><button className="btn-primario w-full" disabled={ocupado || c.rodadasDisponiveis <= 0} onClick={() => girar(c.id)}><Dices size={20} /> Girar roleta · {c.rodadasDisponiveis} rodada(s) disponível(is)</button></>}
      {!barbeiro && gestao && <p className="text-xs text-zinc-500">As rodadas aparecem no acesso individual de cada barbeiro.</p>}
      <div><h3 className="mb-2 text-sm font-semibold">Histórico de bônus · {reais(c.bonus.reduce((s,b) => s+b.valorCentavos,0))}</h3><ul className="space-y-2 text-sm">{c.bonus.map(b => <li className="flex flex-wrap justify-between gap-2 border-t border-zinc-200 pt-2" key={b.id}><span>Rodada {b.ciclo}{gestao ? ` · vendedor ${(b.nomeBarbeiro ?? b.barbeiroId)}` : ""}</span><b>{reais(b.valorCentavos)} · {b.pagoEm ? "Pago" : "Lançado na folha"}</b></li>)}</ul></div>
    </section>)}
  </div>;
}
