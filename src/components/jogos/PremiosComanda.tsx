"use client";

/**
 * Premios de jogo na comanda: os abertos do cliente (validar aqui: servico gratis e desconto entram como desconto
 * nesta comanda; brinde fica como entregue) e os ja usados nesta comanda (desfazer enquanto aberta).
 */
import { useState } from "react";
import { Check, Sparkles, Undo2 } from "lucide-react";
import { api, reais } from "@/lib/cliente-api";
import { descricaoPremio, type Raridade, type StatusPremio, type TipoPremio } from "@/lib/jogos/tipos";
import { IconePremio } from "./kit/IconePremio";

export type PremioNaComanda = {
  id: string; codigo: string; rotulo: string; tipo: TipoPremio; raridade: Raridade; icone: string; percentual: number; valorCentavos: number;
  status: StatusPremio; expiraEm: string | null; descontoAplicadoCentavos: number; comandaId: string | null;
};

export function PremiosComanda({ comandaId, premios, aberta, aoMudar }: { comandaId: string; premios: PremioNaComanda[]; aberta: boolean; aoMudar: () => void }) {
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState("");
  const usados = premios.filter((p) => p.comandaId === comandaId && p.status === "UTILIZADO");
  const abertos = premios.filter((p) => p.status === "DISPONIVEL" || p.status === "RESERVADO");
  if (!usados.length && !(aberta && abertos.length)) return null;

  async function enviar(p: PremioNaComanda, corpo: Record<string, unknown>) {
    setErro("");
    setOcupado(p.id);
    try { await api(`/api/premios/${p.id}`, { method: "POST", body: corpo }); aoMudar(); } catch (e) { setErro((e as Error).message); } finally { setOcupado(""); }
  }

  return (
    <section className="cartao-destaque space-y-2">
      <h2 className="flex items-center gap-2 text-sm font-semibold"><Sparkles size={16} className="text-ouro" /> Prêmios dos jogos</h2>
      {aberta && abertos.map((p) => (
        <div key={p.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-200 p-2.5 text-sm">
          <IconePremio icone={p.icone} tamanho={22} cor="#d3ab45" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{p.rotulo} <span className="font-mono text-xs text-zinc-500">{p.codigo}</span></p>
            <p className="text-xs text-zinc-500">{descricaoPremio(p)}{p.status === "RESERVADO" ? " · reservado para este horário" : ""}</p>
          </div>
          <button className="btn-primario" disabled={!!ocupado} onClick={() => enviar(p, { acao: "validar", comandaId })}>
            <Check size={14} /> {p.tipo === "BRINDE" ? "Entregar" : "Aplicar"}
          </button>
        </div>
      ))}
      {usados.map((p) => (
        <div key={p.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-emerald-50 p-2.5 text-sm text-emerald-800">
          <Check size={16} />
          <span className="min-w-0 flex-1"><b>{p.rotulo}</b> utilizado{p.descontoAplicadoCentavos > 0 ? `: desconto de ${reais(p.descontoAplicadoCentavos)}` : ""}</span>
          {aberta && <button className="btn py-1 text-xs" disabled={!!ocupado} onClick={() => enviar(p, { acao: "desfazer" })}><Undo2 size={13} /> Desfazer</button>}
        </div>
      ))}
      {erro && <p className="rounded-lg bg-red-50 p-2 text-xs text-red-700">{erro}</p>}
    </section>
  );
}
