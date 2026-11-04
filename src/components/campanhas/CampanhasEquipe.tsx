"use client";
import { useCallback, useEffect, useState } from "react";
import { Dices } from "lucide-react";
import { api, paraCentavos, reais } from "@/lib/cliente-api";
import { ContadorCrm } from "@/components/visual/ContadorCrm";
type Servico = { id: string; nome: string; ativo: boolean };
type Campanha = { id: string; nome: string; tipo: "PRODUTOS" | "SERVICOS"; servicoIds: string[]; inicio: string; fim: string; metaQuantidade: number; metaCentavos: number; premios: number[]; rodadasDisponiveis: number; vendas: { quantidade: number; receita: number; ciclos: number } | null; bonus: { id: string; barbeiroId: string; ciclo: number; valorCentavos: number; pagoEm: string | null; folhaLancamentoId: string | null; nomeBarbeiro: string | null }[] };
export function CampanhasEquipe({ gestao, barbeiro }: { gestao: boolean; barbeiro: boolean }) {
  const [cs, setCs] = useState<Campanha[]>([]), [msg, setMsg] = useState(""), [ocupado, setOcupado] = useState(false);
  const [tipo, setTipo] = useState<"PRODUTOS" | "SERVICOS">("SERVICOS"), [servicos, setServicos] = useState<Servico[]>([]);
  const carregar = useCallback(() => api<Campanha[]>("/api/campanhas-equipe").then(setCs).catch(e => setMsg(e.message)), []);
  useEffect(() => { carregar(); api<Servico[]>("/api/servicos").then(setServicos).catch(e => setMsg(e.message)); }, [carregar]);
  async function criar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); const form = e.currentTarget, f = new FormData(form); setOcupado(true); setMsg("");
    try { await api("/api/campanhas-equipe", { method: "POST", body: { acao: "criar", nome: f.get("nome"), inicio: new Date(String(f.get("inicio"))).toISOString(), fim: new Date(String(f.get("fim"))).toISOString(), tipo, servicoIds: tipo === "SERVICOS" ? f.getAll("servicos") : [], metaQuantidade: Number(f.get("quantidade")), metaCentavos: tipo === "SERVICOS" ? 0 : paraCentavos(String(f.get("receita"))), premios: String(f.get("premios")).split(";").map(paraCentavos) } }); form.reset(); await carregar(); setMsg("Campanha criada. As regras ficam fixas para preservar as rodadas conquistadas."); }
    catch(e) { setMsg((e as Error).message); } finally { setOcupado(false); }
  }
  async function girar(campanhaId: string) {
    setOcupado(true); setMsg("");
    try { const r = await api<{ valorCentavos: number }>("/api/campanhas-equipe", { method: "POST", body: { acao: "girar", campanhaId } }); setMsg(`Você ganhou ${reais(r.valorCentavos)} de bônus! Registrado para conferência e pagamento pela gestão.`); await carregar(); }
    catch(e) { setMsg((e as Error).message); } finally { setOcupado(false); }
  }
  return <div className="space-y-5"><header className="crm-page-header cabecalho-gestao"><div><p className="eyebrow">Reconhecimento da equipe</p><h1 className="titulo-marca text-3xl">Campanhas e bônus</h1><p className="mt-2 text-sm text-zinc-600">Venda, complete as metas e libere sua rodada. Bônus adicional à comissão.</p></div></header>
    {msg && <p role="status" className="cartao-destaque">{msg}</p>}
    <p className="text-sm text-zinc-600">Campanhas de serviços contam atendimentos concluídos no período, inclusive cobertos por plano. As de produtos contam vendas em comandas fechadas e pagas. Serviços ligados a comanda cancelada ou com estorno e produtos com estorno ficam fora da apuração. Bônus já lançado não é cancelado automaticamente.</p>
    {gestao && <form className="cartao grid gap-3 sm:grid-cols-2" onSubmit={criar}><h2 className="font-semibold sm:col-span-2">Criar campanha</h2>
      <label className="rotulo sm:col-span-2">Nome<input name="nome" className="campo" minLength={3} maxLength={100} required /></label>
      <label className="rotulo">Início (horário deste aparelho)<input name="inicio" type="datetime-local" className="campo" required /></label><label className="rotulo">Fim (horário deste aparelho)<input name="fim" type="datetime-local" className="campo" required /></label>
      <label className="rotulo sm:col-span-2">Tipo de campanha<select className="campo" value={tipo} onChange={e => setTipo(e.target.value as "PRODUTOS" | "SERVICOS")}><option value="SERVICOS">Serviços realizados</option><option value="PRODUTOS">Produtos vendidos</option></select></label>
      {tipo === "SERVICOS" && <fieldset className="sm:col-span-2"><legend className="font-medium">Serviços que contam para a rodada</legend><div className="mt-2 flex flex-wrap gap-3">{servicos.filter(s => s.ativo).map(s => <label key={s.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="servicos" value={s.id} />{s.nome}</label>)}</div><p className="text-xs text-zinc-500">Selecione pelo menos um serviço.</p></fieldset>}
      <label className="rotulo">{tipo === "SERVICOS" ? "Serviços" : "Produtos"} por rodada<input name="quantidade" type="number" className="campo" min={1} max={10000} defaultValue={10} required /></label>
      {tipo === "PRODUTOS" && <label className="rotulo">Valor vendido por rodada (R$)<input name="receita" inputMode="decimal" className="campo" defaultValue="300,00" required /></label>}
      <label className="rotulo sm:col-span-2">Bônus possíveis em R$ (separados por ponto e vírgula)<input name="premios" className="campo" defaultValue="5; 10; 30; 50" required /><span className="text-xs text-zinc-500">Cada posição tem a mesma chance. Com quatro posições, 25% cada. Valores repetidos aumentam a chance daquele valor. Nenhum pagamento é feito automaticamente.</span></label>
      <button className="btn-primario sm:col-span-2" disabled={ocupado}>Criar campanha com estas regras</button>
    </form>}
    {cs.length === 0 && <p className="cartao text-sm text-zinc-500">Nenhuma campanha criada ainda.</p>}
    {cs.map(c => <section key={c.id} className="cartao-destaque space-y-4"><div><h2 className="text-xl font-bold">{c.nome}</h2><p className="text-xs text-zinc-500">{new Date(c.inicio).toLocaleString("pt-BR")} até {new Date(c.fim).toLocaleString("pt-BR")}</p></div>
      <p className="text-sm">Uma rodada a cada <b>{c.metaQuantidade} {c.tipo === "SERVICOS" ? "serviços" : "produtos"}</b>{c.metaCentavos > 0 && <> e <b>{reais(c.metaCentavos)}</b> em vendas elegíveis</>}.{c.tipo === "SERVICOS" && <> Serviços: {c.servicoIds.map(id => servicos.find(s => s.id === id)?.nome ?? "Serviço indisponível").join(", ")}.</>}</p>
      <div className="flex flex-wrap gap-2">{c.premios.map((p,i) => <span key={i} className="rounded-xl border border-ouro/30 bg-ouro/10 px-3 py-2 text-sm text-ouro">{reais(p)} · {(100/c.premios.length).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</span>)}</div>
      {c.vendas && <><div className="grid grid-cols-2 gap-3 text-sm"><div className="crm-kpi cartao"><p className="text-xs text-zinc-500">{c.tipo === "SERVICOS" ? "Seus serviços" : "Seus produtos"}</p><p className="mt-2 text-2xl font-normal"><ContadorCrm valor={c.vendas.quantidade} /></p></div>{c.tipo !== "SERVICOS" && <div className="crm-kpi cartao"><p className="text-xs text-zinc-500">Suas vendas</p><p className="mt-2 text-2xl font-normal"><ContadorCrm valor={c.vendas.receita} formatar={reais} /></p></div>}</div><button className="btn-primario w-full" disabled={ocupado || c.rodadasDisponiveis <= 0 || c.tipo === "SERVICOS"} onClick={() => girar(c.id)}><Dices size={20} /> {c.tipo === "SERVICOS" ? `Giro indisponível · ${c.rodadasDisponiveis} rodada(s) calculada(s)` : `Girar roleta · ${c.rodadasDisponiveis} rodada(s) disponível(is)`}</button>{c.tipo === "SERVICOS" && <p className="text-xs text-zinc-500">O progresso está visível. Os giros serão liberados após a definição do tratamento de estornos.</p>}</>}
      {!barbeiro && gestao && <p className="text-xs text-zinc-500">As rodadas aparecem no acesso individual de cada barbeiro.</p>}
      <div><h3 className="mb-2 text-sm font-semibold">Histórico de bônus · {reais(c.bonus.reduce((s,b) => s+b.valorCentavos,0))}</h3><ul className="space-y-2 text-sm">{c.bonus.map(b => <li className="flex flex-wrap justify-between gap-2 border-t border-zinc-200 pt-2" key={b.id}><span>Rodada {b.ciclo}{gestao ? ` · vendedor ${(b.nomeBarbeiro ?? b.barbeiroId)}` : ""}</span><b>{reais(b.valorCentavos)} · {b.pagoEm ? "Pago" : b.folhaLancamentoId ? "Lançado na folha" : "A conferir pela gestão"}</b></li>)}</ul></div>
    </section>)}
  </div>;
}
