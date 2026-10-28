"use client";

import { useEffect } from "react";
import { observarInstalacao } from "@/lib/pwa/instalacao";
import { registrarApp } from "@/lib/pwa/push-cliente";

/** Registro silencioso: não instala nem solicita notificações sem gesto. */
export function RegistroApp({ area }: { area: "cliente" | "equipe" }) {
  useEffect(() => {
    observarInstalacao();
    if (window.isSecureContext && "serviceWorker" in navigator) {
      void registrarApp().catch(() => { /* A central mostra suporte e permite tentar novamente. */ });
    }
  }, [area]);
  return null;
}
