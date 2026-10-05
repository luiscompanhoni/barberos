"use client";

import { useEffect, useState } from "react";
import { CalendarPlus, Check, Copy, RefreshCw } from "lucide-react";
import { api } from "@/lib/cliente-api";

type Links = { ics: string; webcal: string; google: string; publico: boolean };

/** Link para ver a agenda do barbeiro no Google Agenda / calendario do celular (so leitura). */
export function CalendarioLink({ barbeiroId }: { barbeiroId: string }) {
  const [l, setL] = useState<Links | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    api<Links>(`/api/barbeiros/${barbeiroId}/calendario`).then(setL).catch((e) => setErro(e.message));
  }, [barbeiroId]);

  async function trocar() {
    if (!confirm("Gerar um link novo? O link antigo para de funcionar em todos os aparelhos.")) return;
    setL(await api<Links>(`/api/barbeiros/${barbeiroId}/calendario`, { method: "POST" }));
  }

  return (
    <section className="cartao space-y-3">
      <div className="flex items-center gap-2">
        <CalendarPlus size={18} className="text-ouro" />
        <h2 className="font-semibold">Ver no Google Agenda / celular</h2>
      </div>
      <p className="text-sm text-zinc-500">
        Os atendimentos e horários fechados aparecem no calendário do celular e atualizam sozinhos (o Google leva alguns minutos
        a algumas horas). Só leitura: marcar e mudar continua sendo aqui.
      </p>
      {erro && <p className="text-sm text-red-600">{erro}</p>}
      {l && (
        <>
          <div className="flex flex-wrap gap-2">
            <a className="btn-primario" href={l.google} target="_blank" rel="noreferrer">Adicionar ao Google Agenda</a>
            <a className="btn" href={l.webcal}>iPhone / Outlook</a>
            <button className="btn" onClick={async () => { await navigator.clipboard?.writeText(l.ics); setCopiado(true); setTimeout(() => setCopiado(false), 2000); }}>
              {copiado ? <><Check size={14} /> Copiado</> : <><Copy size={14} /> Copiar link</>}
            </button>
          </div>
          {!l.publico && (
            <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
              O sistema ainda está só no computador: o Google só consegue ler o link depois que o BarberOS estiver no ar (PAINEL_URL com https).
            </p>
          )}
          <button className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-900" onClick={trocar}>
            <RefreshCw size={12} /> Trocar o link (se ele vazou)
          </button>
        </>
      )}
    </section>
  );
}
