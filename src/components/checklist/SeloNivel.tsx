import { Crown, Gem, Shield } from "lucide-react";
import estilos from "./niveis.module.css";

export type Nivel = "ELITE" | "PLATINA" | "LEGEND";
export const NOME_NIVEL: Record<Nivel, string> = { ELITE: "BLACK ELITE", PLATINA: "BLACK PLATINA", LEGEND: "BLACK LEGEND" };

// Cores fixas em hex (o tema escuro inverte a escala do tailwind).
const ESTILO: Record<Nivel, React.CSSProperties> = {
  ELITE: { background: "#0b0b0b", color: "#d3ab45", border: "1px solid #d3ab45" },
  PLATINA: { background: "linear-gradient(135deg,#f4f4f2 0%,#c9cacc 45%,#9fa1a6 100%)", color: "#1b1c1f", border: "1px solid #e5e4e2" },
  LEGEND: { background: "linear-gradient(135deg,#fff3b0 0%,#f2c94c 35%,#d3ab45 65%,#a87b12 100%)", color: "#1a1406", border: "1px solid #ffe58a", boxShadow: "0 0 14px rgba(242,201,76,.55)" },
};
const ICONE = { ELITE: Shield, PLATINA: Gem, LEGEND: Crown };

/** Selo da faixa do checklist (BLACK ELITE / PLATINA / LEGEND). */
export function SeloNivel({ nivel, pequeno }: { nivel: Nivel; pequeno?: boolean }) {
  const Icone = ICONE[nivel];
  return (
    <span style={ESTILO[nivel]} className={`inline-flex items-center gap-1 rounded-full font-black tracking-wider whitespace-nowrap ${nivel === "LEGEND" ? estilos.legend : ""} ${pequeno ? "px-2 py-0.5 text-[10px]" : "px-3 py-1 text-xs"}`}>
      <Icone size={pequeno ? 11 : 13} /> {NOME_NIVEL[nivel]}
    </span>
  );
}

/** Barra de progresso ate a proxima faixa. */
export function ProgressoNivel({ percentual, proximo, faltam }: { percentual: number; proximo: Nivel | null; faltam: number }) {
  return (
    <div className="space-y-1">
      <div className="h-2 overflow-hidden rounded-full bg-zinc-200"><div className="h-full bg-ouro transition-all" style={{ width: `${percentual}%` }} /></div>
      <p className="text-[11px] text-zinc-500">{proximo ? `Faltam ${faltam} pts para ${NOME_NIVEL[proximo]}` : "Topo alcançado 👑"}</p>
    </div>
  );
}
