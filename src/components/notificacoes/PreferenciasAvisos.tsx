"use client";

import { useState } from "react";
import { api } from "@/lib/cliente-api";
import type { PreferenciasNotificacoes } from "@/lib/notificacoes/tipos";

const OPCOES: { chave: keyof PreferenciasNotificacoes; nome: string; detalhe: string }[] = [
  { chave: "agenda", nome: "Agenda", detalhe: "Lembretes dos seus próximos atendimentos." },
  { chave: "avaliacoes", nome: "Avaliações", detalhe: "Convites e avisos sobre avaliações internas." },
  { chave: "recompra", nome: "Recompra de serviços", detalhe: "Lembretes para repetir serviços no período indicado." },
  { chave: "equipe", nome: "Rotina da equipe", detalhe: "Resumo da sua agenda e oportunidades de encaixe no dia." },
];
export function PreferenciasAvisos(p: { area: "cliente" | "equipe"; preferencias: PreferenciasNotificacoes; onSalvo: () => Promise<void> }) {
  const [ocupado, setOcupado] = useState(false);
  const [mensagem, setMensagem] = useState("");
  async function alterar(chave: keyof PreferenciasNotificacoes, permitido: boolean) {
    setOcupado(true); setMensagem("");
    try {
      await api("/api/notificacoes/preferencias", { method: "PUT", body: { ...p.preferencias, [chave]: permitido } });
      await p.onSalvo(); setMensagem("Preferência salva.");
    } catch (e) { setMensagem((e as Error).message); }
    finally { setOcupado(false); }
  }
  return <section className="cartao space-y-3" aria-labelledby="preferencias-avisos-titulo">
    <h2 id="preferencias-avisos-titulo" className="font-semibold">Quais avisos você quer receber?</h2>
    <div className="divide-y divide-zinc-200">{OPCOES.filter(o => p.area === "equipe" ? o.chave === "equipe" : o.chave !== "equipe").map(o => <label key={o.chave} className="flex cursor-pointer items-start gap-3 py-3">
      <input className="mt-1 h-5 w-5 accent-ouro focus-visible:ring-2 focus-visible:ring-ouro" type="checkbox" name={o.chave} disabled={ocupado} checked={p.preferencias[o.chave]} onChange={e => void alterar(o.chave, e.target.checked)} />
      <span className="text-sm"><strong className="block font-medium">{o.nome}</strong><span className="text-zinc-500">{o.detalhe}</span></span>
    </label>)}</div>
    <p role="status" className="text-sm text-zinc-500">{ocupado ? "Salvando…" : mensagem}</p>
  </section>;
}
