"use client";

import { useState } from "react";
import type { PainelAgentes } from "@/lib/agentes/tipos";
import { GRUPOS } from "./cliente";

const normalizar = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function Catalogo({ painel }: { painel: PainelAgentes }) {
  const [busca, setBusca] = useState("");
  const mapa = new Map(painel.integracoes.map(i => [i.id, i]));
  const nomes = new Map(painel.catalogo.map(a => [a.id, a.nome]));
  const agentes = painel.catalogo.filter(a => normalizar(`${a.nome} ${a.objetivo}`).includes(normalizar(busca)));
  return <section className="space-y-4" aria-labelledby="catalogo-titulo">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="eyebrow">Especialistas conectados</p><h2 id="catalogo-titulo" className="text-xl font-semibold">Agentes da Black</h2><p className="mt-1 text-sm text-zinc-500">Cada agente prepara seu trabalho e propõe o próximo responsável.</p></div><label className="rotulo mb-0">Encontrar agente<input className="campo mt-1" type="search" value={busca} onChange={e => setBusca(e.target.value)} placeholder="Nome ou objetivo" /></label></div>
    {!agentes.length ? <p className="cartao text-sm text-zinc-500">Nenhum agente encontrado para esta busca.</p> : null}
    {Object.entries(GRUPOS).map(([grupo, rotulo]) => {
      const lista = agentes.filter(a => a.grupo === grupo);
      if (!lista.length) return null;
      return <div key={grupo}><h3 className="mb-3 text-sm font-semibold text-zinc-500">{rotulo}</h3><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{lista.map(a => <article className="cartao space-y-3" key={a.id}><h4 className="font-semibold">{a.nome}</h4><p className="text-sm text-zinc-600">{a.objetivo}</p>
        <div className="flex flex-wrap gap-1.5">{a.integracoes.length ? a.integracoes.map(id => { const i = mapa.get(id); return <span key={id} className={`rounded-full px-2.5 py-1 text-xs ${i?.disponivel ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{i?.nome ?? id}: {i?.disponivel ? "configurada" : "pendente"}</span>; }) : <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-600">Contexto interno</span>}</div>
        {a.proximos.length ? <p className="text-xs text-zinc-500">Pode encaminhar para {a.proximos.map(id => nomes.get(id) ?? id).join(", ")}.</p> : null}
      </article>)}</div></div>;
    })}
  </section>;
}

export function Integracoes({ painel }: { painel: PainelAgentes }) {
  return <section className="space-y-3" aria-labelledby="integracoes-titulo"><div><p className="eyebrow">Conexões</p><h2 id="integracoes-titulo" className="text-xl font-semibold">Capacidades disponíveis</h2><p className="mt-1 text-sm text-zinc-500">Uma integração pendente limita a execução correspondente. Nenhuma imagem, vídeo, mensagem ou resultado de anúncio é simulado.</p></div><div className="grid gap-3 md:grid-cols-2">{painel.integracoes.map(i => <article key={i.id} className="cartao space-y-2"><div className="flex items-start justify-between gap-2"><h3 className="font-semibold">{i.nome}</h3><span className={`rounded-full px-2.5 py-1 text-xs ${i.disponivel ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{i.disponivel ? "Configurada" : "Pendente"}</span></div><p className="text-sm text-zinc-500">{i.detalhe}</p></article>)}</div></section>;
}
