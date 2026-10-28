"use client";

import { useRef, useState } from "react";
import type { Coluna } from "./tipos";
import { instanteLocal } from "@/lib/agenda/tempo";

type Selecao = { coluna: Coluna; inicioMin: number; fimMin: number };
export function useSelecaoGrade(p: { inicioDia: number; fimDia: number; pxMin: number; gran: number; fuso: string; onSelecionar: (col: Coluna, inicio: number, fim?: number) => void }) {
  const [selecao, setSelecao] = useState<Selecao | null>(null);
  const gesto = useRef<{ coluna: Coluna; topo: number; inicio: number; fim: number; moveu: boolean; y: number } | null>(null);
  const minuto = (y: number, topo: number) => Math.min(p.fimDia - p.gran, Math.max(p.inicioDia, Math.floor((p.inicioDia + (y - topo) / p.pxMin) / p.gran) * p.gran));

  function iniciar(e: React.PointerEvent<HTMLDivElement>, coluna: Coluna) {
    if (e.button !== 0) return;
    const topo = e.currentTarget.getBoundingClientRect().top;
    const inicio = minuto(e.clientY, topo);
    gesto.current = { coluna, topo, inicio, fim: inicio + p.gran, moveu: false, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
    setSelecao({ coluna, inicioMin: inicio, fimMin: inicio + p.gran });
  }
  function mover(e: React.PointerEvent) {
    const g = gesto.current;
    if (!g) return;
    if (Math.abs(e.clientY - g.y) < 5 && !g.moveu) return;
    g.moveu = true;
    const m = minuto(e.clientY, g.topo);
    g.fim = m;
    setSelecao({ coluna: g.coluna, inicioMin: Math.min(g.inicio, m), fimMin: Math.max(g.inicio + p.gran, g.fim) });
  }
  function cancelar() { gesto.current = null; setSelecao(null); }
  function soltar() {
    const g = gesto.current;
    if (!g) return false;
    const inicio = Math.min(g.inicio, g.fim);
    const fim = Math.max(g.inicio + p.gran, g.fim);
    p.onSelecionar(g.coluna, instanteLocal(g.coluna.data, inicio, p.fuso), g.moveu ? instanteLocal(g.coluna.data, fim, p.fuso) : undefined);
    cancelar();
    return true;
  }
  return { selecao, iniciar, mover, cancelar, soltar };
}
