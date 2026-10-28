"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/cliente-api";
import { dataLocal, diaSemana, somarDias } from "@/lib/agenda/tempo";
import type { ListaReuniao, ReuniaoResposta } from "@/lib/reunioes/tipos";
import { RelatorioReuniao } from "./Relatorio";
import { EditorReuniao } from "./EditorReuniao";
import { Apresentacao } from "./Apresentacao";

const hoje = () => dataLocal(Date.now(), "America/Sao_Paulo");
function semanaAnterior() {
  const d = hoje(), segunda = somarDias(d, -((diaSemana(d) + 6) % 7));
  return { inicio: somarDias(segunda, -7), fim: somarDias(segunda, -1) };
}
export function ReunioesTela() {
  const [tipo, setTipo] = useState<"DIARIA" | "SEMANAL">("SEMANAL");
  const [periodo, setPeriodo] = useState(semanaAnterior), [titulo, setTitulo] = useState("Reunião semanal");
  const [lista, setLista] = useState<ListaReuniao[]>([]), [selecionada, setSelecionada] = useState<ReuniaoResposta | null>(null);
  const [apresentacao, setApresentacao] = useState<ReuniaoResposta | null>(null), [erro, setErro] = useState(""), [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState("");
  const carregar = useCallback(() => api<ListaReuniao[]>("/api/reunioes").then(setLista).catch((e: Error) => setErro(e.message)), []);
  useEffect(() => { void carregar(); }, [carregar]);
  const fechar = useCallback(() => setApresentacao(null), []);
  async function gerar(e: React.FormEvent) {
    e.preventDefault(); setErro(""); setAviso(""); setOcupado(true);
    try { setSelecionada(await api<ReuniaoResposta>("/api/reunioes", { method: "POST", body: { titulo, tipo, ...periodo } })); await carregar(); setAviso("Reunião gerada e salva com os dados deste momento."); }
    catch (e) { setErro((e as Error).message); } finally { setOcupado(false); }
  }
  async function abrir(id: string, apresentar?: "equipe" | "gestao") {
    setErro(""); setOcupado(true);
    try {
      const r = await api<ReuniaoResposta>(`/api/reunioes/${id}${apresentar ? `?apresentacao=${apresentar}` : ""}`);
      if (apresentar) setApresentacao(r); else setSelecionada(r);
    } catch (e) { setErro((e as Error).message); } finally { setOcupado(false); }
  }
  return <div className="space-y-5"><div><p className="eyebrow">Gestão da equipe</p><h1 className="titulo-marca">Reuniões</h1><p className="mt-2 text-sm text-zinc-500">Transforme os registros da barbearia em resultados, slides e ações para a próxima semana.</p></div>
    <form onSubmit={gerar} className="cartao space-y-3"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><label className="rotulo">Reunião<select className="campo mt-1" value={tipo} onChange={(e) => { const t = e.target.value as typeof tipo; setTipo(t); setTitulo(t === "DIARIA" ? "Reunião diária" : "Reunião semanal"); setPeriodo(t === "DIARIA" ? { inicio: hoje(), fim: hoje() } : semanaAnterior()); }}><option value="SEMANAL">Semanal · 60 min</option><option value="DIARIA">Diária · 20 min</option></select></label>
      <label className="rotulo">Título<input className="campo mt-1" value={titulo} minLength={3} maxLength={120} required onChange={(e) => setTitulo(e.target.value)} /></label>
      <label className="rotulo">De<input className="campo mt-1" type="date" value={periodo.inicio} required onChange={(e) => setPeriodo((p) => ({ ...p, inicio: e.target.value, ...(tipo === "DIARIA" ? { fim: e.target.value } : {}) }))} /></label>
      <label className="rotulo">Até<input className="campo mt-1" type="date" value={periodo.fim} min={periodo.inicio} disabled={tipo === "DIARIA"} required onChange={(e) => setPeriodo((p) => ({ ...p, fim: e.target.value }))} /></label></div>
      <div className="flex flex-wrap items-center gap-3"><button className="btn-primario" disabled={ocupado}>{ocupado ? "Preparando…" : "Gerar reunião e slides"}</button><a className="btn" href="/meu-dia">Abrir agenda e projeção individual</a><p className="text-xs text-zinc-500">A geração salva um retrato dos resultados. A projeção diária usa a agenda atual em “Meu dia”.</p></div></form>
    {erro && <p role="alert" className="text-sm text-red-600">{erro}</p>}{aviso && <p role="status" className="text-sm text-emerald-600">{aviso}</p>}
    <label className="block rotulo">Reuniões salvas<select className="campo mt-1" value={selecionada?.id ?? ""} disabled={ocupado} onChange={(e) => { if (e.target.value) void abrir(e.target.value); }}><option value="">Selecione uma reunião</option>{lista.map((r) => <option key={r.id} value={r.id}>{r.titulo} · {r.inicio} a {r.fim}</option>)}</select></label>
    {!selecionada && <div className="cartao py-12 text-center text-sm text-zinc-500">Gere uma reunião ou selecione uma já salva para consultar seus resultados.</div>}
    {selecionada && <><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">{selecionada.titulo}</h2><div className="flex flex-wrap gap-2"><button className="btn-primario" disabled={ocupado} onClick={() => abrir(selecionada.id, "equipe")}>Apresentar para a equipe</button><button className="btn" disabled={ocupado} onClick={() => abrir(selecionada.id, "gestao")}>Apresentar para a gestão</button></div></div>
      <RelatorioReuniao snapshot={selecionada.snapshot} /><EditorReuniao key={`${selecionada.id}:${selecionada.versao}`} reuniao={selecionada} onSalvar={(r) => { setSelecionada(r); void carregar(); setAviso("Conteúdo e ações salvos. Os números originais foram preservados."); }} /></>}
    {apresentacao && <Apresentacao reuniao={apresentacao} onFechar={fechar} />}
  </div>;
}
