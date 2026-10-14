"use client";

import { useSyncExternalStore } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { som } from "./som";

/** Liga/desliga o som (e a vibracao) de todos os jogos. */
export function BotaoSom({ className = "" }: { className?: string }) {
  const mudo = useSyncExternalStore((f) => som.ouvir(f), () => som.mudo, () => false);
  return (
    <button
      type="button"
      onClick={() => { som.destravar(); som.alternarMudo(); }}
      aria-label={mudo ? "Ligar som" : "Desligar som"}
      aria-pressed={!mudo}
      className={`jogo-botao-redondo ${className}`}
    >
      {mudo ? <VolumeX size={18} /> : <Volume2 size={18} />}
    </button>
  );
}
