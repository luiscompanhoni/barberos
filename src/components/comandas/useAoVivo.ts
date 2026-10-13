"use client";

import { useEffect } from "react";

/** Recarrega quando chega evento de comanda (outro caixa, maquininha aprovou...). */
export function useAoVivo(tipo: string, recarregar: () => void) {
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const es = new EventSource("/api/eventos");
    es.onmessage = (ev) => {
      try {
        if (JSON.parse(ev.data).tipo !== tipo) return;
      } catch {
        return;
      }
      clearTimeout(t);
      t = setTimeout(recarregar, 200);
    };
    return () => { clearTimeout(t); es.close(); };
  }, [tipo, recarregar]);
}
