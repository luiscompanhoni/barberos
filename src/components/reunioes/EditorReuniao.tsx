"use client";

import { useState } from "react";
import { api } from "@/lib/cliente-api";
import type { AcaoReuniao, ReuniaoResposta } from "@/lib/reunioes/tipos";

export function EditorReuniao({ reuniao: r, onSalvar }: { reuniao: ReuniaoResposta; onSalvar: (r: ReuniaoResposta) => void }) {
  const [titulo, setTitulo] = useState(r.titulo), [conteudo, setConteudo] = useState(r.conteudo), [acoes, setAcoes] = useState(r.acoes);
  const [erro, setErro] = useState(""), [salvando, setSalvando] = useState(false);
  function alterar(i: number, dados: Partial<AcaoReuniao>) { setAcoes((as) => as.map((a, ix) => ix === i ? { ...a, ...dados } : a)); }
  async function salvar(e: React.FormEvent) {
    e.preventDefault(); setErro(""); setSalvando(true);
    try { onSalvar(await api<ReuniaoResposta>(`/api/reunioes/${r.id}`, { method: "PATCH", body: { versao: r.versao, titulo, conteudo, acoes } })); }
    catch (e) { setErro((e as Error).message); } finally { setSalvando(false); }
  }
  if (!r.podeEditar) return <section className="cartao space-y-3"><h3 className="font-semibold">Conteúdo e plano de ação</h3><p className="whitespace-pre-wrap text-sm">{r.conteudo || "Conteúdo reservado ao autor e à gestão autorizada."}</p>{r.acoes.map((a) => <p className="text-sm" key={a.id}>{a.concluida ? "✓" : "○"} {a.texto} · {a.responsavel} · {a.prazo}</p>)}</section>;
  return <form className="cartao space-y-4" onSubmit={salvar}><h3 className="font-semibold">Conteúdo e plano de ação</h3><label className="block rotulo">Título<input className="campo mt-1" value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={120} required minLength={3} /></label>
    <label className="block rotulo">Conteúdo da barbearia, metas e treinamento<textarea className="campo mt-1 min-h-28" value={conteudo} onChange={(e) => setConteudo(e.target.value)} maxLength={12000} /></label>
    <p className="text-xs text-zinc-500">Conteúdo livre e ações aparecem na apresentação da gestão. A versão da equipe omite esses campos para proteger informações individuais.</p>
    {acoes.map((a, i) => <div key={a.id} className="space-y-2 rounded-xl border border-zinc-200 p-3"><div className="flex items-center justify-between"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={a.concluida} onChange={(e) => alterar(i, { concluida: e.target.checked })} />Concluída</label><button type="button" className="text-xs underline" onClick={() => setAcoes((as) => as.filter((x) => x.id !== a.id))}>Remover ação {i + 1}</button></div>
      <label className="block rotulo">Ação {i + 1}<input className="campo mt-1" value={a.texto} required minLength={3} maxLength={500} onChange={(e) => alterar(i, { texto: e.target.value })} /></label>
      <div className="grid gap-2 sm:grid-cols-3"><label className="rotulo">Responsável<input className="campo mt-1" value={a.responsavel} required maxLength={100} onChange={(e) => alterar(i, { responsavel: e.target.value })} /></label>
        <label className="rotulo">Enviar para “Meu dia”<select className="campo mt-1" value={a.barbeiroId ?? ""} onChange={(e) => { const b = r.snapshot.barbeiros.find((b) => b.id === e.target.value); alterar(i, { barbeiroId: e.target.value || null, responsavel: b?.nome ?? a.responsavel }); }}><option value="">Somente gestão</option>{r.snapshot.barbeiros.filter((b) => b.id !== "sem-profissional").map((b) => <option key={b.id} value={b.id}>{b.nome}</option>)}</select></label>
        <label className="rotulo">Prazo<input className="campo mt-1" type="date" value={a.prazo} required onChange={(e) => alterar(i, { prazo: e.target.value })} /></label></div></div>)}
    <div className="flex flex-wrap gap-2"><button type="button" className="btn" disabled={acoes.length >= 50} onClick={() => setAcoes((as) => [...as, { id: crypto.randomUUID(), texto: "", barbeiroId: null, responsavel: "", prazo: r.fim, concluida: false }])}>Adicionar ação</button><button className="btn-primario" disabled={salvando}>{salvando ? "Salvando…" : "Salvar conteúdo e ações"}</button></div>{erro && <p role="alert" className="text-sm text-red-600">{erro}</p>}
  </form>;
}
