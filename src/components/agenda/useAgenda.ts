"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/cliente-api";
import type { AgendaApi } from "./tipos";

/**
 * Carrega a agenda e mantem atualizada em tempo real: qualquer mudanca (bot,
 * site, outra tela) chega por SSE e dispara um recarregamento.
 */
export function useAgenda(data: string, dias: number, barbeiroId?: string) {
  const [agenda, setAgenda] = useState<AgendaApi | null>(null);
  const [erro, setErro] = useState("");
  const [aoVivo, setAoVivo] = useState(false);
  const pedido = useRef(0);

  const recarregar = useCallback(async () => {
    const meu = ++pedido.current;
    try {
      const q = new URLSearchParams({ data, dias: String(dias), ...(barbeiroId ? { barbeiroId } : {}) });
      const a = await api<AgendaApi>(`/api/agenda?${q}`);
      if (meu === pedido.current) {
        setAgenda(a);
        setErro("");
      }
    } catch (e) {
      if (meu === pedido.current) setErro((e as Error).message);
    }
  }, [data, dias, barbeiroId]);

  useEffect(() => {
    // Busca inicial dos dados; o estado so muda depois da resposta.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    recarregar();
  }, [recarregar]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const es = new EventSource("/api/eventos");
    es.onopen = () => setAoVivo(true);
    es.onerror = () => setAoVivo(false);
    es.onmessage = (ev) => {
      try {
        if (JSON.parse(ev.data).tipo !== "agenda") return;
      } catch {
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(recarregar, 250);
    };
    const aoFocar = () => recarregar();
    window.addEventListener("focus", aoFocar);
    return () => {
      clearTimeout(timer);
      es.close();
      window.removeEventListener("focus", aoFocar);
    };
  }, [recarregar]);

  return { agenda, erro, aoVivo, recarregar, setAgenda };
}
