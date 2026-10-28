"use client";

import { useState } from "react";
import { Modal } from "@/components/Modal";
import { useAcesso } from "@/components/AcessoContexto";
import { api } from "@/lib/cliente-api";
import { instanteLocal, minParaHhmm, minutosLocal } from "@/lib/agenda/tempo";
import { EncaixeModal } from "./EncaixeModal";

export function HorarioModal(p: React.ComponentProps<typeof EncaixeModal>) {
  const { permissoes } = useAcesso();
  const [aba, setAba] = useState<"agendar" | "bloquear">("agendar");
  const [barbeiroId, setBarbeiroId] = useState(p.barbeiroId);
  const min = (t: number | null | undefined, padrao: number) => t ? minutosLocal(t, p.fuso) : padrao;
  const [inicio, setInicio] = useState(minParaHhmm(min(p.inicio, 9 * 60)));
  const [fim, setFim] = useState(minParaHhmm(min(p.fim, min(p.inicio, 9 * 60) + 30)));
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const tabs = <div className="mb-4 flex gap-2" role="tablist" aria-label="Ação no intervalo">
    <button role="tab" aria-selected={aba === "agendar"} className={aba === "agendar" ? "btn-primario" : "btn"} onClick={() => setAba("agendar")}>Agendar horário</button>
    {permissoes.bloquear_agenda && <button role="tab" aria-selected={aba === "bloquear"} className={aba === "bloquear" ? "btn-primario" : "btn"} onClick={() => setAba("bloquear")}>Bloquear horário</button>}
  </div>;

  async function bloquear(e: React.FormEvent) {
    e.preventDefault(); setOcupado(true); setErro("");
    try {
      const ms = (h: string) => instanteLocal(p.data, Number(h.slice(0, 2)) * 60 + Number(h.slice(3)), p.fuso);
      if (ms(fim) <= ms(inicio)) throw new Error("O fim precisa ser depois do início.");
      const body = { inicio: new Date(ms(inicio)).toISOString(), fim: new Date(ms(fim)).toISOString(), motivo, confirmar: false };
      const previa = await api<{ conflitos: { id: string }[] }>(`/api/barbeiros/${barbeiroId}/bloqueios`, { method: "POST", body });
      if (previa.conflitos.length) throw new Error(`Há ${previa.conflitos.length} atendimento(s) nesse intervalo. Resolva os clientes afetados em Expediente antes de bloquear.`);
      await api(`/api/barbeiros/${barbeiroId}/bloqueios`, { method: "POST", body: { ...body, confirmar: true } });
      p.onCriado(`Agenda bloqueada das ${inicio} às ${fim}.`);
    } catch (e) { setErro((e as Error).message); setOcupado(false); }
  }
  if (aba === "agendar") return <EncaixeModal {...p} cabecalho={tabs} />;
  return <Modal titulo="Novo horário" onFechar={p.onFechar}>{tabs}
    <form onSubmit={bloquear} className="space-y-3">
      <label className="rotulo">Profissional<select className="campo" value={barbeiroId} onChange={e => setBarbeiroId(e.target.value)}>{p.barbeiros.map(b => <option key={b.id} value={b.id}>{b.nome}</option>)}</select></label>
      <div className="grid grid-cols-2 gap-3">
        <label className="rotulo">Início<input required type="time" className="campo" value={inicio} onChange={e => setInicio(e.target.value)} /></label>
        <label className="rotulo">Fim<input required type="time" className="campo" value={fim} onChange={e => setFim(e.target.value)} /></label>
      </div>
      <label className="rotulo">Motivo<input required maxLength={120} className="campo" value={motivo} onChange={e => setMotivo(e.target.value)} /></label>
      {erro && <p role="alert" className="text-sm text-red-600">{erro}</p>}
      <div className="flex justify-end gap-2"><button type="button" className="btn" onClick={p.onFechar}>Voltar</button><button className="btn-primario" disabled={ocupado}>{ocupado ? "Salvando…" : "Bloquear horário"}</button></div>
    </form>
  </Modal>;
}
