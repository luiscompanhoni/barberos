"use client";

import { useState } from "react";
import { Modal } from "@/components/Modal";
import { api } from "@/lib/cliente-api";
import type { Coluna } from "./tipos";

export function BloqueioModal(p: {
  bloqueio: Coluna["bloqueios"][number]; barbeiroNome: string; fuso: string;
  onFechar: () => void; onRemovido: (mensagem: string) => void;
}) {
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const fmt = (iso: string) => new Date(iso).toLocaleString("pt-BR", {
    timeZone: p.fuso, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
  async function remover() {
    setOcupado(true); setErro("");
    try {
      await api(`/api/bloqueios/${p.bloqueio.id}`, { method: "DELETE" });
      p.onRemovido("Bloqueio removido. Agenda liberada para novos horários.");
    } catch (e) { setErro((e as Error).message); setOcupado(false); }
  }
  return <Modal titulo="Bloqueio da agenda" onFechar={p.onFechar}>
    <div className="space-y-3">
      <p className="font-semibold">{p.barbeiroNome}</p>
      <p className="text-sm">{fmt(p.bloqueio.inicio)} até {fmt(p.bloqueio.fim)}</p>
      {p.bloqueio.motivo && <p className="text-sm text-zinc-500">{p.bloqueio.motivo}</p>}
      <p className="text-sm">Remover este bloqueio libera o período para novos agendamentos.</p>
      {erro && <p role="alert" className="text-sm text-red-600">{erro}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn" onClick={p.onFechar} disabled={ocupado}>Voltar</button>
        <button type="button" className="btn-primario" onClick={remover} disabled={ocupado}>{ocupado ? "Removendo…" : "Remover bloqueio"}</button>
      </div>
    </div>
  </Modal>;
}
