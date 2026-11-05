"use client";

import { useRef, useState } from "react";
import { api, reais } from "@/lib/cliente-api";

export type AlteracaoPlano = { id: string; nome: string; precoCentavos: number; efetivaEm: string; estado: string; tipo: string } | null;
type PlanoOpcao = { id: string; nome: string; precoCentavos: number };

export function TrocarPlano(p: {
  endpoint: string; equipe?: boolean; podeAplicar?: boolean; planoAtualId: string; valorAtual: number; renovacao: string | null;
  planos: PlanoOpcao[]; pedido: AlteracaoPlano; onAlterado: () => Promise<unknown> | void;
}) {
  const [planoId, setPlanoId] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [mensagem, setMensagem] = useState("");
  const [erro, setErro] = useState(false);
  const trava = useRef(false);
  const opcoes = p.planos.filter(x => x.id !== p.planoAtualId);
  const selecionado = opcoes.find(x => x.id === planoId);
  const data = (valor: string) => valor.slice(0, 10).split("-").reverse().join("/");

  async function enviar(acao: "solicitar_troca" | "cancelar_troca" | "aplicar_troca") {
    if (trava.current) return;
    trava.current = true; setOcupado(true); setMensagem(""); setErro(false);
    try {
      await api(p.endpoint, { method: p.equipe ? "POST" : "PATCH", body: { acao, ...(acao === "solicitar_troca" ? { planoId } : {}) } });
      setMensagem(acao === "solicitar_troca" ? "Pedido registrado. A recepção confere a renovação antes de aplicar o novo plano." : acao === "cancelar_troca" ? "Pedido cancelado. Seu plano atual foi mantido." : "Novo plano aplicado após a conferência.");
      await p.onAlterado();
      setPlanoId("");
    } catch (e) { setErro(true); setMensagem((e as Error).message); }
    finally { trava.current = false; setOcupado(false); }
  }

  return <section className="space-y-3 rounded-xl border border-zinc-200 p-4" aria-label="Alterar plano">
    <h2 className="font-semibold">Upgrade ou downgrade do plano</h2>
    <p className="text-sm text-zinc-500">A mudança vale na próxima renovação, após a conferência da recepção. O período já pago mantém o plano atual, sem cobrança proporcional.</p>
    {p.pedido ? <div className="space-y-3">
      <p className="text-sm"><strong>{p.pedido.nome}</strong> · {reais(p.pedido.precoCentavos)}/mês · a partir de {data(p.pedido.efetivaEm)}</p>
      <p className="text-xs text-amber-800" role="status">Pedido aguardando conferência. O plano atual continua valendo.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn" disabled={ocupado || p.pedido.estado !== "SOLICITADA"} onClick={() => enviar("cancelar_troca")}>Cancelar pedido de troca</button>
        {p.equipe && p.podeAplicar && <button type="button" className="btn-primario" disabled={ocupado} onClick={() => enviar("aplicar_troca")}>Conferir e aplicar na renovação</button>}
      </div>
      {p.equipe && <p className="text-xs text-zinc-500">A aplicação exige início do novo período e cobrança compatível. Contratos externos precisam da alteração no provedor e da renovação confirmada.</p>}
    </div> : <form className="space-y-3" onSubmit={e => { e.preventDefault(); if (selecionado) void enviar("solicitar_troca"); }}>
      <label className="rotulo">Novo plano
        <select className="campo mt-1" value={planoId} onChange={e => setPlanoId(e.target.value)} disabled={ocupado} required>
          <option value="">Escolha um plano</option>
          {opcoes.map(x => <option key={x.id} value={x.id}>{x.nome} · {reais(x.precoCentavos)}/mês · {x.precoCentavos > p.valorAtual ? "upgrade" : x.precoCentavos < p.valorAtual ? "downgrade" : "troca"}</option>)}
        </select>
      </label>
      {selecionado && <p className="text-sm">Mensalidade: {reais(p.valorAtual)} → <strong>{reais(selecionado.precoCentavos)}</strong>. Renovação: {p.renovacao ? data(p.renovacao) : "a conferir"}.</p>}
      <button className="btn-primario" disabled={!selecionado || !p.renovacao || ocupado}>{ocupado ? "Registrando…" : "Solicitar alteração do plano"}</button>
      {!opcoes.length && <p className="text-sm text-zinc-500">Nenhum outro plano está disponível para a forma de pagamento atual.</p>}
    </form>}
    {mensagem && <p role={erro ? "alert" : "status"} className={`text-sm ${erro ? "text-red-700" : "text-emerald-700"}`}>{mensagem}</p>}
  </section>;
}
