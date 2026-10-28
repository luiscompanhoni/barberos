"use client";

import { useEffect, useState } from "react";
import { useAcesso } from "@/components/AcessoContexto";
import { api } from "@/lib/cliente-api";
import { dataLocal, instanteLocal, minParaHhmm, minutosLocal } from "@/lib/agenda/tempo";
import type { AgendamentoApi } from "./tipos";

export function AjustarHorario(p: { ag: AgendamentoApi; fuso: string; onAlterado: (msg: string) => void }) {
  const { permissoes } = useAcesso();
  const [aberto, setAberto] = useState(false);
  const [hora, setHora] = useState(minParaHhmm(minutosLocal(Date.parse(p.ag.inicio), p.fuso)));
  const [duracao, setDuracao] = useState(String((Date.parse(p.ag.fim) - Date.parse(p.ag.inicio)) / 60_000));
  const [motivo, setMotivo] = useState("");
  const [cadeiraId, setCadeiraId] = useState(p.ag.cadeiraId ?? "");
  const [cadeiras, setCadeiras] = useState<{ id: string; nome: string; ativa: boolean }[]>([]);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => { if (aberto) api<typeof cadeiras>("/api/cadeiras").then(setCadeiras).catch(e => setErro(e.message)); }, [aberto]);
  async function salvar(e: React.FormEvent) {
    e.preventDefault(); setOcupado(true); setErro("");
    try {
      const inicio = instanteLocal(dataLocal(Date.parse(p.ag.inicio), p.fuso), Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3)), p.fuso);
      await api(`/api/agendamentos/${p.ag.id}`, { method: "PATCH", body: { inicio: new Date(inicio).toISOString(), fim: new Date(inicio + Number(duracao) * 60_000).toISOString(), cadeiraId: cadeiraId || null, motivo } });
      p.onAlterado("Horário atualizado. Preço e duração padrão do catálogo preservados.");
    } catch (e) { setErro((e as Error).message); setOcupado(false); }
  }
  if (["CONCLUIDO", "CANCELADO"].includes(p.ag.status)) return null;
  return <div className="mt-3">
    <button type="button" className="btn" onClick={() => setAberto(!aberto)} aria-expanded={aberto}>Alterar horário, duração ou cadeira</button>
    {aberto && <form onSubmit={salvar} className="mt-3 space-y-2 rounded-lg border border-zinc-200 p-3">
      <div className="grid grid-cols-2 gap-2"><label className="rotulo">Início<input required type="time" className="campo" value={hora} onChange={e => setHora(e.target.value)} /></label>
        <label className="rotulo">Duração (min)<input required type="number" min={5} max={480} disabled={!permissoes.duracao} className="campo" value={duracao} onChange={e => setDuracao(e.target.value)} /></label></div>
      <label className="rotulo">Cadeira<select className="campo" value={cadeiraId} onChange={e => setCadeiraId(e.target.value)}><option value="">Não informada</option>{cadeiras.filter(c => c.ativa || c.id === cadeiraId).map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></label>
      <label className="rotulo">Motivo do ajuste<input maxLength={200} className="campo" value={motivo} onChange={e => setMotivo(e.target.value)} /></label>
      {erro && <p role="alert" className="text-sm text-red-600">{erro}</p>}<button className="btn-primario" disabled={ocupado}>{ocupado ? "Salvando…" : "Salvar ajuste"}</button>
    </form>}
  </div>;
}
