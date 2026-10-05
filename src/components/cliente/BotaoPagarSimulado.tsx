"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/cliente-api";

export function BotaoPagarSimulado({ id }: { id: string }) {
  const router = useRouter();
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  return (
    <div className="space-y-2">
      <button
        className="btn-primario w-full py-2"
        disabled={enviando}
        onClick={async () => {
          setEnviando(true);
          try {
            await api(`/api/pagamentos/simulado/${id}`, { method: "POST" });
            router.refresh();
          } catch (e) {
            setErro((e as Error).message);
            setEnviando(false);
          }
        }}
      >
        {enviando ? "Processando..." : "Pagar (simulação)"}
      </button>
      {erro && <p className="text-sm text-red-600">{erro}</p>}
    </div>
  );
}
