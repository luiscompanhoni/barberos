"use client";
import { useRef } from "react";

/** Aceita digitação, colagem e o código inteiro enviado pelo autofill do celular. */
export function CaixasCodigo({ valor, onChange }: { valor: string; onChange: (v: string) => void }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digitos = Array.from({ length: 6 }, (_, i) => valor[i] ?? "");
  function digitar(i: number, texto: string, colagem = false) {
    const novos = texto.replace(/\D/g, "");
    if (!novos) return;
    const inteiro = colagem || novos.length >= 6;
    const pos = Math.min(i, valor.length);
    const v = inteiro ? novos.slice(0, 6) : valor.slice(0, pos) + novos.slice(-1) + valor.slice(pos + 1);
    onChange(v);
    refs.current[Math.min(inteiro ? v.length : pos + 1, 5)]?.focus();
  }
  return <div className="grid grid-cols-6 gap-2">
    {digitos.map((d, i) => <input
      key={i}
      ref={(el) => { refs.current[i] = el; }}
      aria-label={`Dígito ${i + 1}`}
      inputMode="numeric"
      autoComplete={i === 0 ? "one-time-code" : "off"}
      autoFocus={i === 0}
      value={d}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => digitar(i, e.target.value)}
      onPaste={(e) => { e.preventDefault(); digitar(0, e.clipboardData.getData("text"), true); }}
      onKeyDown={(e) => {
        if (e.key === "Backspace") {
          e.preventDefault();
          const pos = d ? i : Math.max(i - 1, 0);
          onChange(valor.slice(0, pos));
          refs.current[pos]?.focus();
        }
      }}
      className="h-14 min-w-0 rounded-xl border border-zinc-300 bg-white text-center text-xl font-bold text-zinc-900 outline-none focus:border-ouro focus:ring-2 focus:ring-ouro/25"
    />)}
  </div>;
}
