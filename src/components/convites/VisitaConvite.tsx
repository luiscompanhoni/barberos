"use client";

import { useEffect } from "react";

export type EtapaVisita = "login" | "entrou" | "agenda" | "instalou";

export function VisitaConvite({ etapa, token }: { etapa: EtapaVisita; token?: string }) {
  useEffect(() => {
    const registrar = async (evento: EtapaVisita) => {
      await fetch("/api/convite-app/visita", { method: "POST", credentials: "same-origin", keepalive: true,
        headers: { "content-type": "application/json" }, body: JSON.stringify({ evento, token }),
        signal: AbortSignal.timeout(5000) }).catch(() => {});
    };
    let iniciou = false;
    let ativo = true;
    const visivel = () => {
      if (iniciou || document.visibilityState !== "visible") return;
      iniciou = true;
      void registrar(etapa).then(() => {
        if (!ativo) return;
        if (window.matchMedia("(display-mode: standalone)").matches ||
          (navigator as Navigator & { standalone?: boolean }).standalone) void registrar("instalou");
      });
    };
    const instalou = () => { void registrar("instalou"); };
    visivel();
    document.addEventListener("visibilitychange", visivel);
    window.addEventListener("appinstalled", instalou);
    return () => { ativo = false; document.removeEventListener("visibilitychange", visivel); window.removeEventListener("appinstalled", instalou); };
  }, [etapa, token]);
  return null;
}
