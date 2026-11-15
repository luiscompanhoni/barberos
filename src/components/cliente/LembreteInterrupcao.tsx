"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/cliente-api";

/** Prévia opt-in: guarda a intenção e a última ação; não envia mensagens. */
export function LembreteInterrupcao({ chaveAtividade }: { chaveAtividade: string }) {
  const [ativo, setAtivo] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const fila = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    let vivo = true;
    api<{ ativo: boolean }>("/api/cliente/lembrete-agendamento")
      .then(r => { if (vivo) setAtivo(r.ativo); })
      .catch(() => { if (vivo) setErro("Não foi possível consultar sua preferência de lembrete."); })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, []);

  const registrar = (metodo: "POST" | "DELETE") => {
    fila.current = fila.current.catch(() => {}).then(() => api<{ ativo: boolean }>("/api/cliente/lembrete-agendamento", { method: metodo }))
      .then(() => setErro(""))
      .catch(() => { setErro("Não foi possível guardar sua preferência. Tente novamente."); if (metodo === "POST") setAtivo(false); });
  };

  useEffect(() => {
    if (!carregando && ativo) registrar("POST");
    // Atualiza a última ação; o servidor decidirá se já passaram duas horas.
  }, [chaveAtividade, carregando, ativo]);

  return <div className="mt-5 rounded-xl border border-ouro/30 bg-ouro/5 p-4 text-sm">
    <label className="flex cursor-pointer items-start gap-3">
      <input type="checkbox" className="mt-1" checked={ativo} disabled={carregando}
        onChange={e => { setAtivo(e.target.checked); if (!e.target.checked) registrar("DELETE"); }} />
      <span>Se eu interromper o agendamento, quero que a Black me ajude pelo WhatsApp cerca de 2 horas após minha última ação.</span>
    </label>
    <p className="mt-2 text-xs text-zinc-500">Você pode desmarcar a qualquer momento. Esta prévia ainda não envia mensagens.</p>
    {erro && <p role="alert" className="mt-2 text-xs text-red-700">{erro}</p>}
  </div>;
}
