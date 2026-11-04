"use client";

import { useState } from "react";
import { api } from "@/lib/cliente-api";

export type Aviso = { id: string; tipo: "AVISO" | "OBJETIVO"; texto: string; concluido: boolean; versao: number };

function Item({ aviso, salvo }: { aviso: Aviso; salvo: (a: Aviso) => void }) {
  const [texto, setTexto] = useState(aviso.texto), [tipo, setTipo] = useState(aviso.tipo), [concluido, setConcluido] = useState(aviso.concluido);
  const [versaoBase, setVersaoBase] = useState(aviso.versao);
  const [erro, setErro] = useState(""), [ocupado, setOcupado] = useState(false);
  const desatualizado = aviso.versao !== versaoBase;
  async function salvar(e: React.FormEvent) {
    e.preventDefault(); setErro(""); setOcupado(true);
    try {
      const atualizado = await api<Aviso>(`/api/reunioes/avisos/${aviso.id}`, { method: "PATCH", body: { tipo, texto, concluido, versao: versaoBase } });
      setVersaoBase(atualizado.versao); salvo(atualizado);
    }
    catch (e) { setErro((e as Error).message); } finally { setOcupado(false); }
  }
  function carregarAtual() {
    setTipo(aviso.tipo); setTexto(aviso.texto); setConcluido(aviso.concluido); setVersaoBase(aviso.versao); setErro("");
  }
  return <form onSubmit={salvar} className="space-y-2 rounded-xl border border-zinc-200 p-3">
    <div className="flex flex-wrap items-center gap-3"><label className="text-sm">Tipo <select className="campo ml-1" value={tipo} onChange={e => setTipo(e.target.value as Aviso["tipo"])}><option value="AVISO">Aviso</option><option value="OBJETIVO">Objetivo</option></select></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={concluido} onChange={e => setConcluido(e.target.checked)} />Concluído</label></div>
    <label className="rotulo block">Texto<textarea className="campo mt-1" value={texto} onChange={e => setTexto(e.target.value)} required minLength={3} maxLength={500} /></label>
    {desatualizado && <div role="status" className="space-y-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
      <p>Este item mudou em outra sessão. Seu rascunho foi preservado; copie o texto antes de carregar a versão atual.</p>
      <button type="button" className="btn" onClick={carregarAtual}>Descartar rascunho e carregar versão atual</button>
    </div>}
    <button className="btn" disabled={ocupado || desatualizado}>{ocupado ? "Salvando…" : "Salvar alteração"}</button>{erro && <p role="alert" className="text-sm text-red-600">{erro}</p>}
  </form>;
}

export function ChecklistAvisos({ avisos, atualizar, recarregar }: { avisos: Aviso[]; atualizar: (a: Aviso) => void; recarregar: () => void }) {
  const [texto, setTexto] = useState(""), [tipo, setTipo] = useState<Aviso["tipo"]>("AVISO");
  const [erro, setErro] = useState(""), [ocupado, setOcupado] = useState(false);
  async function criar(e: React.FormEvent) {
    e.preventDefault(); setErro(""); setOcupado(true);
    try { atualizar(await api<Aviso>("/api/reunioes/avisos", { method: "POST", body: { texto, tipo } })); setTexto(""); }
    catch (e) { setErro((e as Error).message); } finally { setOcupado(false); }
  }
  return <section className="cartao space-y-4"><div><h2 className="text-lg font-semibold">Avisos e objetivos da semana</h2>
    <p className="mt-1 text-sm text-zinc-500">Anote durante a semana. Os itens pendentes aparecem na apresentação da equipe; não inclua informações privadas.</p></div>
    <form onSubmit={criar} className="grid gap-2 sm:grid-cols-[auto_1fr_auto] sm:items-end">
      <label className="rotulo">Tipo<select className="campo mt-1" value={tipo} onChange={e => setTipo(e.target.value as Aviso["tipo"])}><option value="AVISO">Aviso</option><option value="OBJETIVO">Objetivo</option></select></label>
      <label className="rotulo">Novo item<input className="campo mt-1" value={texto} onChange={e => setTexto(e.target.value)} required minLength={3} maxLength={500} placeholder="Ex.: varrer após cada atendimento" /></label>
      <button className="btn-primario" disabled={ocupado}>{ocupado ? "Adicionando…" : "Adicionar"}</button>
    </form>
    {erro && <p role="alert" className="text-sm text-red-600">{erro}</p>}
    {avisos.length === 0 && <p className="text-sm text-zinc-500">Nenhum aviso ou objetivo cadastrado.</p>}
    <div className="grid gap-3 lg:grid-cols-2">{avisos.map(a => <Item key={a.id} aviso={a} salvo={atualizar} />)}</div>
    <button type="button" className="btn" onClick={recarregar}>Atualizar lista</button><p className="text-xs text-zinc-500">Atualize a lista se outra pessoa alterou um item. Itens concluídos ficam no histórico.</p>
  </section>;
}
