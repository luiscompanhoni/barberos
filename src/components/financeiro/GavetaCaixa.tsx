"use client";

import { useEffect, useRef, useState } from "react";
import { Wallet, X } from "lucide-react";
import { useAcesso } from "@/components/AcessoContexto";
import { CaixaTela } from "./CaixaTela";

const DURACAO_MS = 220;

/** Atalho do caixa na recepcao: botao fixo que abre uma aba lateral com o caixa compacto. */
export function GavetaCaixa() {
  const podeMexer = useAcesso().permissoes.caixa;
  const [montada, setMontada] = useState(false);
  const [visivel, setVisivel] = useState(false);
  const painelRef = useRef<HTMLDivElement>(null);
  const botaoRef = useRef<HTMLButtonElement>(null);

  const abrir = () => {
    setMontada(true);
    requestAnimationFrame(() => requestAnimationFrame(() => setVisivel(true)));
  };
  const fechar = () => setVisivel(false);

  // Desmonta depois da animacao de saida.
  useEffect(() => {
    if (visivel || !montada) return;
    const t = setTimeout(() => { setMontada(false); botaoRef.current?.focus(); }, DURACAO_MS);
    return () => clearTimeout(t);
  }, [visivel, montada]);

  // Esc fecha; trava a rolagem da pagina enquanto aberta.
  useEffect(() => {
    if (!montada) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setVisivel(false); };
    window.addEventListener("keydown", esc);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    painelRef.current?.focus();
    return () => { window.removeEventListener("keydown", esc); document.body.style.overflow = overflow; };
  }, [montada]);

  if (!podeMexer) return null;

  return (
    <>
      <button ref={botaoRef} onClick={abrir} aria-label="Abrir painel de caixa e comandas" aria-haspopup="dialog" aria-expanded={montada} title="Caixa e comandas"
        className="fixed right-4 bottom-24 z-30 flex h-12 items-center gap-2 rounded-full border border-ouro bg-ouro px-4 text-xs font-bold text-fundo uppercase shadow-[0_8px_24px_rgba(0,0,0,0.45)] transition hover:bg-ouro-claro lg:right-6 lg:bottom-6">
        <Wallet size={18} />
        <span>Caixa e comandas</span>
      </button>

      {montada && (
        <div className="fixed inset-0 z-50" role="presentation">
          <div onClick={fechar}
            className={`absolute inset-0 bg-black/60 transition-opacity ${visivel ? "opacity-100" : "opacity-0"}`}
            style={{ transitionDuration: `${DURACAO_MS}ms` }} />
          <div ref={painelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Caixa e comandas"
            className={`absolute inset-y-0 right-0 flex w-full flex-col border-l border-zinc-200 bg-fundo shadow-2xl outline-none transition-transform ease-out sm:w-[460px] ${visivel ? "translate-x-0" : "translate-x-full"}`}
            style={{ transitionDuration: `${DURACAO_MS}ms` }}>
            <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
              <div className="flex items-center gap-2">
                <Wallet size={18} className="text-ouro" />
                <h2 className="font-semibold">Caixa e comandas</h2>
              </div>
              <button onClick={fechar} aria-label="Fechar painel" className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900">
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <CaixaTela compacto />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
