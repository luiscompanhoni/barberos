"use client";

import { useState } from "react";
import { BellRing, Check } from "lucide-react";
import { api } from "@/lib/cliente-api";

const PERIODOS: [string, string][] = [["QUALQUER", "Qualquer hora"], ["MANHA", "Manhã"], ["TARDE", "Tarde"], ["NOITE", "Noite"]];

/** Dia sem horario livre: o cliente entra na lista de espera e e avisado no WhatsApp se abrir vaga. */
export function SemVaga({ data, servicoId, barbeiroId }: { data: string; servicoId: string; barbeiroId: string | null }) {
  const [periodo, setPeriodo] = useState("QUALQUER");
  const [estado, setEstado] = useState<"inicio" | "enviando" | "ok">("inicio");
  const [erro, setErro] = useState("");

  async function entrar() {
    setErro("");
    setEstado("enviando");
    try {
      await api("/api/cliente/espera", { method: "POST", body: { data, servicoId, barbeiroId, periodo } });
      setEstado("ok");
    } catch (e) {
      setErro((e as Error).message);
      setEstado("inicio");
    }
  }

  if (estado === "ok") {
    return (
      <div className="cartao mt-3 flex gap-3 text-sm">
        <Check className="shrink-0 text-ouro" size={18} />
        <p>Pronto! Se abrir um horário nesse dia, você recebe as opções no WhatsApp. Quem responder primeiro fica com a vaga.</p>
      </div>
    );
  }
  return (
    <div className="cartao mt-3 space-y-3 text-sm">
      <p className="text-zinc-500">Sem horários livres nesse dia{barbeiroId ? " com esse barbeiro" : ""}. Tente outro dia ou entre na lista de espera:</p>
      <div className="flex flex-wrap gap-1.5">
        {PERIODOS.map(([v, r]) => (
          <button key={v} onClick={() => setPeriodo(v)} className={`rounded-full px-3 py-1 text-xs font-semibold ${periodo === v ? "bg-ouro text-fundo" : "bg-zinc-100 text-zinc-600"}`}>{r}</button>
        ))}
      </div>
      <button className="btn-primario w-full py-2.5" onClick={entrar} disabled={estado === "enviando"}>
        <BellRing size={15} /> Me avise se abrir horário
      </button>
      {erro && <p className="text-red-600">{erro}</p>}
    </div>
  );
}
