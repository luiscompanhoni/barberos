"use client";

import { useEffect, useRef } from "react";

export function Modal({ titulo, onFechar, children }: { titulo: string; onFechar: () => void; children: React.ReactNode }) {
  const dialogo = useRef<HTMLDivElement>(null);
  const fechar = useRef(onFechar);
  useEffect(() => { fechar.current = onFechar; }, [onFechar]);
  useEffect(() => {
    const modal = dialogo.current;
    if (!modal) return;
    const anterior = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const controles = () => Array.from(modal.querySelectorAll<HTMLElement>(
      'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]',
    )).filter(el => !el.matches(":disabled, [hidden]") && !el.closest("[inert]") && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden");
    if (!modal.contains(document.activeElement)) (controles()[0] ?? modal).focus();
    const teclado = (e: KeyboardEvent) => {
      // Apenas o diálogo mais recente trata o teclado quando há sobreposição.
      if (Array.from(document.querySelectorAll('[data-modal-foco="true"]')).at(-1) !== modal) return;
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); fechar.current(); return; }
      if (e.key !== "Tab") return;
      const itens = controles(), primeiro = itens[0], ultimo = itens.at(-1);
      if (!primeiro || !ultimo) { e.preventDefault(); modal.focus(); return; }
      const foco = document.activeElement;
      if (!modal.contains(foco) || foco === modal || (e.shiftKey && foco === primeiro)) {
        e.preventDefault(); (e.shiftKey ? ultimo : primeiro).focus();
      } else if (!e.shiftKey && foco === ultimo) { e.preventDefault(); primeiro.focus(); }
    };
    window.addEventListener("keydown", teclado);
    return () => {
      window.removeEventListener("keydown", teclado);
      if (anterior?.isConnected) anterior.focus();
    };
  }, []);

  return (
    <div className="crm-modal-backdrop fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onFechar}>
      <div ref={dialogo} tabIndex={-1} data-modal-foco="true" className="crm-modal max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 focus:outline-none sm:max-w-md sm:rounded-2xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={titulo}>
        <header className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{titulo}</h2>
          <button className="rounded-lg px-2 py-1 text-zinc-500 hover:bg-zinc-100" onClick={onFechar} aria-label="Fechar">✕</button>
        </header>
        {children}
      </div>
    </div>
  );
}
