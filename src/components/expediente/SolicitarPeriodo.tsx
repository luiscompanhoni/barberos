"use client";

import { useState } from "react";
import { api } from "@/lib/cliente-api";
import { hhmmParaMin } from "@/lib/agenda/tempo";

export function SolicitarPeriodo(p: { barbeiroId: string; hoje: string; onSolicitado: () => void }) {
  const [tipo, setTipo] = useState<"FOLGA" | "BLOQUEIO">("FOLGA"), [data, setData] = useState(""), [inicio, setInicio] = useState("09:00"), [fim, setFim] = useState("10:00"), [motivo, setMotivo] = useState(""), [msg, setMsg] = useState<{ texto: string; erro: boolean } | null>(null), [salvando, setSalvando] = useState(false);
  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setSalvando(true); setMsg(null);
    try {
      await api(`/api/barbeiros/${p.barbeiroId}/solicitacoes-horario`, { method: "POST", body: { acao: "solicitar_periodo", tipo, periodo: { data, inicioMin: tipo === "FOLGA" ? 0 : hhmmParaMin(inicio), fimMin: tipo === "FOLGA" ? 1440 : hhmmParaMin(fim), motivo } } });
      setMsg({ texto: "Solicitação enviada. O horário continua disponível até a aprovação.", erro: false }); setData(""); setMotivo(""); p.onSolicitado();
    } catch (e) { setMsg({ texto: (e as Error).message, erro: true }); } finally { setSalvando(false); }
  }
  return <form className="cartao space-y-3" onSubmit={enviar}><h2 className="font-semibold">Solicitar folga ou bloqueio pontual</h2>
    <p className="text-sm text-zinc-500">O gerente ou dono analisa o pedido e os atendimentos afetados. Uma solicitação pendente por vez.</p>
    <label className="rotulo">Tipo<select className="campo" value={tipo} onChange={e => setTipo(e.target.value as "FOLGA" | "BLOQUEIO")}><option value="FOLGA">Folga no dia inteiro</option><option value="BLOQUEIO">Bloqueio em parte do dia</option></select></label>
    <label className="rotulo">Data<input className="campo" type="date" min={p.hoje} value={data} onChange={e => setData(e.target.value)} required /></label>
    {tipo === "BLOQUEIO" && <div className="grid gap-3 sm:grid-cols-2"><label className="rotulo">Início<input className="campo" type="time" value={inicio} onChange={e => setInicio(e.target.value)} required /></label><label className="rotulo">Fim<input className="campo" type="time" value={fim} onChange={e => setFim(e.target.value)} required /></label></div>}
    <label className="rotulo">Motivo (opcional)<input className="campo" maxLength={500} value={motivo} onChange={e => setMotivo(e.target.value)} /></label>
    {msg && <p role={msg.erro ? "alert" : "status"} className={msg.erro ? "text-sm text-red-700" : "text-sm"}>{msg.texto}</p>}
    <button className="btn-primario" disabled={salvando}>{salvando ? "Enviando..." : "Enviar pedido"}</button>
  </form>;
}
