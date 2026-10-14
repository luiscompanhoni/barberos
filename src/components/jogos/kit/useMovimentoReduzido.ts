"use client";

import { useSyncExternalStore } from "react";

const CONSULTA = "(prefers-reduced-motion: reduce)";

function assinar(f: () => void) {
  const m = window.matchMedia(CONSULTA);
  m.addEventListener("change", f);
  return () => m.removeEventListener("change", f);
}

/** Teste/demonstracao: localStorage "bb-movimento" = "total" ignora a preferencia do aparelho. */
function forcarTotal() {
  try { return localStorage.getItem("bb-movimento") === "total"; } catch { return false; }
}

/** O aparelho pediu "reduzir movimento": animacoes curtas, sem tremor nem chuva de particulas. */
export function useMovimentoReduzido() {
  return useSyncExternalStore(assinar, () => window.matchMedia(CONSULTA).matches && !forcarTotal(), () => false);
}
