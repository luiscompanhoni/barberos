"use client";

import { useState } from "react";
import type { PainelAgentes } from "@/lib/agentes/tipos";
import { apiAgentes, dataAgente } from "./cliente";

type Props = {
  painel: PainelAgentes; ocupado: boolean;
  executar: (acao: () => Promise<void>, mensagem: string) => Promise<void>;
};

export function Rotinas({ painel, ocupado, executar }: Props) {
  const nomes = new Map(painel.catalogo.map(a => [a.id, a.nome]));
  return <section className="space-y-3" aria-labelledby="rotinas-titulo">
    <div><p className="eyebrow">Trabalho recorrente</p><h2 id="rotinas-titulo" className="text-xl font-semibold">Rotinas da barbearia</h2><p className="mt-1 text-sm text-zinc-500">As rotinas geram tarefas internas no intervalo escolhido. Cada resultado fica registrado para revisão.</p></div>
    {!painel.rotinas.length ? <p className="cartao py-8 text-center text-sm text-zinc-500">Nenhuma rotina configurada. Use “Salvar como rotina repetida” no formulário de tarefa.</p> : <div className="grid gap-3 lg:grid-cols-2">{painel.rotinas.map(r => <article className="cartao space-y-3" key={r.id}>
      <div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold">{r.nome}</h3><p className="text-xs text-zinc-500">{nomes.get(r.agenteId) ?? r.agenteId} · a cada {r.cadaMinutos < 1440 ? `${r.cadaMinutos / 60} h` : `${r.cadaMinutos / 1440} dia(s)`}</p></div><span className={`rounded-full px-3 py-1 text-xs ${r.ativa ? "bg-emerald-50 text-emerald-700" : "bg-zinc-100 text-zinc-600"}`}>{r.ativa ? "Ativa" : "Pausada"}</span></div>
      <p className="whitespace-pre-wrap break-words text-sm text-zinc-600">{r.tarefa}</p>
      <p className="text-xs text-zinc-500">Próxima referência: {dataAgente(r.proximaEm)} · horário de São Paulo</p>
      {r.ativa && (!painel.execucaoHabilitada || painel.configuracao.pausada) ? <p className="text-xs text-amber-700">A execução aguarda a liberação da central.</p> : null}
      <button className="btn" disabled={ocupado || (!r.ativa && !painel.execucaoHabilitada)} onClick={() => void executar(async () => { await apiAgentes(`/rotinas/${encodeURIComponent(r.id)}`, "PATCH", { ativa: !r.ativa, revisao: r.revisao }); }, r.ativa ? "Rotina pausada." : "Rotina ativada para gerar tarefas internas.")}>{r.ativa ? "Pausar rotina" : "Ativar rotina"}</button>
    </article>)}</div>}
  </section>;
}

export function ConfiguracaoAgentes({ painel, ocupado, executar }: Props) {
  const cfg = painel.configuracao;
  const [limite, setLimite] = useState(cfg.limiteDiario);
  return <form className="cartao space-y-3" onSubmit={e => { e.preventDefault(); void executar(async () => { await apiAgentes("", "PATCH", { pausada: cfg.pausada, limiteDiario: limite, revisao: cfg.revisao }); }, "Limite diário atualizado."); }}>
    <h2 className="font-semibold">Controle de execução</h2>
    <p className="text-sm text-zinc-500">O limite vale para a central inteira. Pausar impede novas execuções; trabalhos já iniciados podem terminar.</p>
    <div className="flex flex-wrap items-end gap-3"><label className="rotulo mb-0">Limite diário de execuções<input className="campo mt-1 max-w-48" type="number" min={1} max={200} step={1} required value={limite} disabled={ocupado} onChange={e => setLimite(Number(e.target.value))} /></label><button className="btn" disabled={ocupado || limite === cfg.limiteDiario}>Salvar limite</button><button className="btn" type="button" disabled={ocupado} onClick={() => void executar(async () => { await apiAgentes("", "PATCH", { pausada: !cfg.pausada, limiteDiario: cfg.limiteDiario, revisao: cfg.revisao }); }, cfg.pausada ? "Central liberada para executar conforme a configuração." : "Central pausada.")}>{cfg.pausada ? "Retomar central" : "Pausar central"}</button></div>
  </form>;
}
