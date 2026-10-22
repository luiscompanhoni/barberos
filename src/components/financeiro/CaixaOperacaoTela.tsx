"use client";

import { useState } from "react";
import { LockOpen, Receipt } from "lucide-react";
import { ComandasTela } from "@/components/comandas/ComandasTela";
import { CaixaTela } from "./CaixaTela";

export function CaixaOperacaoTela() {
  const [aba, setAba] = useState<"turno" | "comandas">("turno");
  return <div className="space-y-6">
    <header className="cabecalho-gestao">
      <div><p className="eyebrow">Operação do balcão</p><h1 className="titulo-marca mt-1 text-3xl">Caixa</h1>
        <p className="mt-2 text-sm text-zinc-600">Receba, confira a gaveta e encerre o turno.</p></div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Visão do caixa">
        <button className={aba === "turno" ? "btn-primario" : "btn"} aria-pressed={aba === "turno"} onClick={() => setAba("turno")}><LockOpen size={16} /> Abertura e fechamento</button>
        <button className={aba === "comandas" ? "btn-primario" : "btn"} aria-pressed={aba === "comandas"} onClick={() => setAba("comandas")}><Receipt size={16} /> Comandas e recebimentos</button>
      </div>
    </header>
    {aba === "turno" ? <CaixaTela /> : <ComandasTela />}
  </div>;
}
