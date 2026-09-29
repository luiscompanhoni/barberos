"use client";

import { useState } from "react";
import { api, ErroApi } from "@/lib/cliente-api";
import { hhmmParaMin, instanteLocal, somarDias } from "@/lib/agenda/tempo";
import { formatarTelefone } from "@/lib/telefone";

const FUSO = "America/Sao_Paulo";

type Conflito = {
  id: string;
  inicio: string;
  cliente: { nome: string; telefone: string };
  servico: { nome: string };
  barbeirosLivres: { id: string; nome: string }[];
};
export type BloqueioApi = { id: string; inicio: string; fim: string; motivo: string | null };

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: FUSO });

/**
 * Fechar a agenda (horas, um dia ou ferias). Mostra os clientes afetados e so
 * fecha depois de decidir, para cada um, transferir ou cancelar.
 */
export function FecharAgenda(p: { barbeiroId: string; bloqueios: BloqueioApi[]; hoje: string; onSalvo: () => void }) {
  const [diaInteiro, setDiaInteiro] = useState(true);
  const [de, setDe] = useState(p.hoje);
  const [ate, setAte] = useState(p.hoje);
  const [hIni, setHIni] = useState("09:00");
  const [hFim, setHFim] = useState("12:00");
  const [motivo, setMotivo] = useState("");
  const [conflitos, setConflitos] = useState<Conflito[] | null>(null);
  const [escolhas, setEscolhas] = useState<Record<string, string>>({});
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");

  function periodo() {
    if (diaInteiro) {
      if (ate < de) throw new Error("A data final precisa ser igual ou depois da inicial.");
      return { inicio: instanteLocal(de, 0, FUSO), fim: instanteLocal(somarDias(ate, 1), 0, FUSO) };
    }
    const inicio = instanteLocal(de, hhmmParaMin(hIni), FUSO);
    const fim = instanteLocal(de, hhmmParaMin(hFim), FUSO);
    if (fim <= inicio) throw new Error("O horário final precisa ser depois do inicial.");
    return { inicio, fim };
  }

  async function enviar(confirmar: boolean) {
    setErro(""); setOk("");
    let per;
    try { per = periodo(); } catch (e) { return setErro((e as Error).message); }
    const resolucoes = (conflitos ?? []).map((c) => {
      const v = escolhas[c.id] ?? "";
      return v === "cancelar" ? { agendamentoId: c.id, acao: "cancelar" } : { agendamentoId: c.id, acao: "transferir", barbeiroDestinoId: v };
    });
    if (confirmar && conflitos?.some((c) => !escolhas[c.id])) return setErro("Escolha o que fazer com cada cliente.");
    try {
      const r = await api<{ criado: boolean; conflitos?: Conflito[] }>(`/api/barbeiros/${p.barbeiroId}/bloqueios`, {
        method: "POST",
        body: {
          inicio: new Date(per.inicio).toISOString(),
          fim: new Date(per.fim).toISOString(),
          motivo: motivo.trim() || undefined,
          confirmar,
          resolucoes: confirmar ? resolucoes : undefined,
        },
      });
      if (!r.criado && r.conflitos?.length) {
        setConflitos(r.conflitos);
        setEscolhas({});
        return;
      }
      if (!r.criado) return enviar(true); // ninguem afetado: fecha direto
      setConflitos(null); setMotivo("");
      setOk("Agenda fechada. Esses horários sairam do bot e do site.");
      p.onSalvo();
    } catch (e) {
      if (e instanceof ErroApi && e.codigo === "conflitos_pendentes") return enviar(false);
      setErro((e as Error).message);
    }
  }

  async function reabrir(id: string) {
    await api(`/api/bloqueios/${id}`, { method: "DELETE" });
    p.onSalvo();
  }

  return (
    <section className="cartao space-y-3">
      <div>
        <h2 className="font-semibold">Fechar agenda</h2>
        <p className="text-sm text-zinc-500">Imprevisto, médico, férias. Se já tiver cliente marcado, você decide para onde ele vai.</p>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={diaInteiro} onChange={(e) => { setDiaInteiro(e.target.checked); setConflitos(null); }} className="h-4 w-4" />
          Dia(s) inteiro(s)
        </label>
        <div>
          <label className="rotulo">{diaInteiro ? "De" : "Dia"}</label>
          <input type="date" className="campo" min={p.hoje} value={de} onChange={(e) => { setDe(e.target.value); if (ate < e.target.value) setAte(e.target.value); setConflitos(null); }} />
        </div>
        {diaInteiro ? (
          <div>
            <label className="rotulo">Até</label>
            <input type="date" className="campo" min={de} value={ate} onChange={(e) => { setAte(e.target.value); setConflitos(null); }} />
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <input type="time" step={900} className="campo w-28" value={hIni} onChange={(e) => { setHIni(e.target.value); setConflitos(null); }} />
            <span className="text-sm">às</span>
            <input type="time" step={900} className="campo w-28" value={hFim} onChange={(e) => { setHFim(e.target.value); setConflitos(null); }} />
          </div>
        )}
        <input className="campo max-w-xs" placeholder="Motivo (opcional)" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        {!conflitos && <button className="btn-primario" onClick={() => enviar(false)}>Fechar agenda</button>}
      </div>

      {conflitos && (
        <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <p className="text-sm font-medium text-amber-900">{conflitos.length} cliente(s) já marcado(s) nesse período. O que fazer com cada um?</p>
          {conflitos.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="min-w-60">{fmt(c.inicio)} · <b>{c.cliente.nome}</b> · {c.servico.nome} · {formatarTelefone(c.cliente.telefone)}</span>
              <select className="campo w-auto" value={escolhas[c.id] ?? ""} onChange={(e) => setEscolhas((s) => ({ ...s, [c.id]: e.target.value }))}>
                <option value="">Escolha...</option>
                {c.barbeirosLivres.map((b) => <option key={b.id} value={b.id}>Passar para {b.nome}</option>)}
                <option value="cancelar">Cancelar (avisar cliente)</option>
              </select>
              {c.barbeirosLivres.length === 0 && <span className="text-xs text-amber-800">Nenhum barbeiro livre nesse horário</span>}
            </div>
          ))}
          <div className="flex gap-2 pt-1">
            <button className="btn" onClick={() => setConflitos(null)}>Voltar</button>
            <button className="btn-primario" onClick={() => enviar(true)}>Confirmar e fechar</button>
          </div>
        </div>
      )}
      {erro && <p className="text-sm text-red-600">{erro}</p>}
      {ok && <p className="text-sm text-emerald-700">{ok}</p>}

      {p.bloqueios.length > 0 && (
        <ul className="divide-y divide-zinc-100 text-sm">
          {p.bloqueios.map((b) => (
            <li key={b.id} className="flex items-center gap-2 py-2">
              <span>{fmt(b.inicio)} até {fmt(b.fim)}</span>
              {b.motivo && <span className="text-zinc-500">· {b.motivo}</span>}
              <button className="ml-auto text-xs text-zinc-500 underline" onClick={() => reabrir(b.id)}>reabrir</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
