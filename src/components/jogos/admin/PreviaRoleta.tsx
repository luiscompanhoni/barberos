"use client";

import { useRef, useState } from "react";
import type { FatiaRoleta } from "@/lib/jogos/tipos";
import { RodaBlack, type RodaRef } from "../roleta/RodaBlack";
import { useMovimentoReduzido } from "../kit/useMovimentoReduzido";

/** Demonstração puramente visual: não chama o servidor e não sorteia prêmios reais. */
export function PreviaRoleta({ fatias }: { fatias: FatiaRoleta[] }) {
  const roda = useRef<RodaRef>(null);
  const reduzido = useMovimentoReduzido();
  const [girando, setGirando] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);

  async function demonstrar() {
    if (girando || fatias.length < 2 || !roda.current) return;
    const indice = Math.floor(Math.random() * fatias.length);
    const rotulo = fatias[indice].rotulo;
    setResultado(null);
    setGirando(true);
    try {
      await roda.current.girarAte(indice, { reduzido });
      setResultado(rotulo);
    } finally {
      setGirando(false);
    }
  }

  return (
    <div className="rounded-xl bg-zinc-950 p-4 text-white">
      <p className="text-center text-xs font-semibold uppercase tracking-wide text-amber-300">Prévia visual — sem prêmio real</p>
      <div className="mx-auto mt-3 max-w-[320px]">
        <RodaBlack ref={roda} fatias={fatias} girando={girando} podeGirar={fatias.length >= 2} aoGirar={demonstrar} rotuloBotao="TESTAR" rotuloAcessivel="Testar a roleta sem gerar prêmio" />
      </div>
      <p className="mt-3 text-center text-xs text-zinc-300" aria-live="polite">
        {fatias.length < 2 ? "Adicione pelo menos dois prêmios ativos com nome para testar a roleta." : resultado ? `Exemplo: ${resultado}. Nenhum prêmio foi gerado.` : "Toque em testar para visualizar o giro. Nenhuma rodada será consumida."}
      </p>
      <p className="mt-1 text-center text-xs text-zinc-400">Demonstração visual; o resultado não representa as chances reais.</p>
    </div>
  );
}
