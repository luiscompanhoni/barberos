"use client";

import { useRef, useState } from "react";
import type { PainelAgentes } from "@/lib/agentes/tipos";
import { apiAgentes, GRUPOS } from "./cliente";

type Props = {
  catalogo: PainelAgentes["catalogo"]; ocupado: boolean;
  executar: (acao: () => Promise<void>, mensagem: string) => Promise<void>;
};

export function NovaTarefa({ catalogo, ocupado, executar }: Props) {
  const [agenteId, setAgenteId] = useState("estrategia"), [tarefa, setTarefa] = useState("");
  const [recorrente, setRecorrente] = useState(false), [nome, setNome] = useState("");
  const [cadaMinutos, setCadaMinutos] = useState(1440);
  const pedido = useRef<{ conteudo: string; chave: string } | null>(null);
  const selecionado = catalogo.find(a => a.id === agenteId);

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    const corpo = recorrente ? { agenteId, tarefa: tarefa.trim(), nome: nome.trim(), cadaMinutos, ativa: false } : { agenteId, tarefa: tarefa.trim() };
    const conteudo = JSON.stringify(corpo);
    if (pedido.current?.conteudo !== conteudo) pedido.current = { conteudo, chave: crypto.randomUUID() };
    const chave = pedido.current.chave;
    await executar(async () => {
      await apiAgentes(recorrente ? "/rotinas" : "", "POST", { ...corpo, chave });
      pedido.current = null; setTarefa(""); setNome("");
    }, recorrente ? "Rotina salva pausada. Revise e ative quando estiver pronta." : "Tarefa adicionada à fila.");
  }

  return <form className="cartao space-y-4" onSubmit={criar} aria-labelledby="nova-tarefa-titulo">
    <div><p className="eyebrow">Delegar trabalho</p><h2 id="nova-tarefa-titulo" className="text-lg font-semibold">Nova tarefa</h2></div>
    <label className="rotulo">Especialista<select className="campo mt-1" value={agenteId} disabled={ocupado} onChange={e => setAgenteId(e.target.value)}>
      {Object.entries(GRUPOS).map(([grupo, rotulo]) => <optgroup key={grupo} label={rotulo}>{catalogo.filter(a => a.grupo === grupo).map(a => <option key={a.id} value={a.id}>{a.nome}</option>)}</optgroup>)}
    </select></label>
    {selecionado ? <p className="text-sm text-zinc-500">{selecionado.objetivo}</p> : null}
    <label className="rotulo">O que precisa ser feito?<textarea className="campo mt-1 min-h-32" value={tarefa} required minLength={10} maxLength={6000} disabled={ocupado} onChange={e => setTarefa(e.target.value)} placeholder="Ex.: prepare uma campanha para preencher os horários livres desta semana, usando os serviços e preços atuais." /></label>
    <p className="text-xs text-zinc-500">Descreva o objetivo, o período e as restrições. O agente prepara análises e rascunhos; não publica nem movimenta dinheiro.</p>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={recorrente} disabled={ocupado} onChange={e => setRecorrente(e.target.checked)} /> Salvar como rotina repetida</label>
    {recorrente ? <div className="grid gap-3 sm:grid-cols-2">
      <label className="rotulo">Nome da rotina<input className="campo mt-1" value={nome} required minLength={3} maxLength={120} disabled={ocupado} onChange={e => setNome(e.target.value)} /></label>
      <label className="rotulo">Repetir a cada<select className="campo mt-1" value={cadaMinutos} disabled={ocupado} onChange={e => setCadaMinutos(Number(e.target.value))}><option value={60}>1 hora</option><option value={360}>6 horas</option><option value={1440}>1 dia</option><option value={10080}>1 semana</option></select></label>
    </div> : null}
    <div className="flex flex-wrap items-center gap-3"><button className="btn-primario" disabled={ocupado || tarefa.trim().length < 10}>{recorrente ? "Salvar rotina pausada" : "Adicionar à fila"}</button><span className="text-xs text-zinc-500">Execução sujeita à configuração e ao limite diário.</span></div>
  </form>;
}
