"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/cliente-api";

type Cfg = {
  nomeBarbearia: string;
  endereco: string | null;
  granularidadeMin: number;
  antecedenciaMinimaMin: number;
  janelaAgendamentoDias: number;
  intervaloEntreClientes: number;
  prazoCancelamentoMin: number;
  maxAgendamentosCliente: number;
  botAtivo: boolean;
};

/** Dados da barbearia e regras de agendamento (so o dono). */
export function ConfiguracaoTela() {
  const [c, setC] = useState<Cfg | null>(null);
  const [msg, setMsg] = useState<{ texto: string; erro?: boolean } | null>(null);

  useEffect(() => {
    api<Cfg>("/api/configuracao").then(setC).catch((e) => setMsg({ texto: e.message, erro: true }));
  }, []);

  if (!c) return <section className="cartao text-sm text-zinc-500">{msg?.texto ?? "Carregando..."}</section>;
  const campo = <K extends keyof Cfg>(k: K, v: Cfg[K]) => { setC({ ...c, [k]: v }); setMsg(null); };
  const num = (k: keyof Cfg, v: string) => campo(k, Number(v) as never);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api("/api/configuracao", { method: "PATCH", body: { ...c, endereco: c!.endereco?.trim() || null } });
      setMsg({ texto: "Configurações salvas. Bot, site e recepção já usam as novas regras." });
    } catch (e) {
      setMsg({ texto: (e as Error).message, erro: true });
    }
  }

  return (
    <form onSubmit={salvar} className="cartao space-y-3">
      <h2 className="font-semibold">Barbearia e regras de agendamento</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="rotulo" htmlFor="cfg-nome">Nome da barbearia</label>
          <input id="cfg-nome" className="campo" value={c.nomeBarbearia} onChange={(e) => campo("nomeBarbearia", e.target.value)} />
        </div>
        <div>
          <label className="rotulo" htmlFor="cfg-end">Endereço (o bot informa)</label>
          <input id="cfg-end" className="campo" value={c.endereco ?? ""} onChange={(e) => campo("endereco", e.target.value)} />
        </div>
        <div>
          <label className="rotulo" htmlFor="cfg-grade">Grade da agenda</label>
          <select id="cfg-grade" className="campo" value={c.granularidadeMin} onChange={(e) => num("granularidadeMin", e.target.value)}>
            {[5, 10, 15, 20, 30].map((m) => <option key={m} value={m}>de {m} em {m} minutos</option>)}
          </select>
        </div>
        <div>
          <label className="rotulo" htmlFor="cfg-int">Intervalo entre clientes (min)</label>
          <input id="cfg-int" type="number" min={0} max={60} className="campo" value={c.intervaloEntreClientes} onChange={(e) => num("intervaloEntreClientes", e.target.value)} />
        </div>
        <div>
          <label className="rotulo" htmlFor="cfg-ant">Antecedência mínima para o cliente marcar (min)</label>
          <input id="cfg-ant" type="number" min={0} className="campo" value={c.antecedenciaMinimaMin} onChange={(e) => num("antecedenciaMinimaMin", e.target.value)} />
        </div>
        <div>
          <label className="rotulo" htmlFor="cfg-jan">Cliente pode marcar até quantos dias à frente</label>
          <input id="cfg-jan" type="number" min={1} max={120} className="campo" value={c.janelaAgendamentoDias} onChange={(e) => num("janelaAgendamentoDias", e.target.value)} />
        </div>
        <div>
          <label className="rotulo" htmlFor="cfg-prazo">Cliente cancela/remarca sozinho até (horas antes)</label>
          <input id="cfg-prazo" type="number" min={0} step={0.5} className="campo" value={c.prazoCancelamentoMin / 60}
            onChange={(e) => campo("prazoCancelamentoMin", Math.round(Number(e.target.value) * 60))} />
        </div>
        <div>
          <label className="rotulo" htmlFor="cfg-max">Máximo de horários futuros por cliente</label>
          <input id="cfg-max" type="number" min={1} max={10} className="campo" value={c.maxAgendamentosCliente} onChange={(e) => num("maxAgendamentosCliente", e.target.value)} />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="h-4 w-4" checked={c.botAtivo} onChange={(e) => campo("botAtivo", e.target.checked)} />
        Bot do WhatsApp respondendo (desmarcado: toda mensagem vai para a equipe)
      </label>
      {msg && <p className={`text-sm ${msg.erro ? "text-red-600" : "text-emerald-700"}`}>{msg.texto}</p>}
      <button className="btn-primario">Salvar configurações</button>
    </form>
  );
}
