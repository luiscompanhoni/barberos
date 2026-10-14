/**
 * Caixa-surpresa desenhada em SVG (arte original da Black): corpo de metal facetado, arestas e cantoneiras
 * douradas, monograma "BB" na frente e frestas por onde a luz vaza.
 * Tres acabamentos pela raridade: Black (grafite + champanhe), Gold (banhada a ouro), Legend (preto + filigrana).
 * Camadas separadas (corpo, tampa, fresta) para a abertura animar so a tampa.
 * Variaveis CSS herdadas: --luz (0..1, fresta e raios) e --aberta (0..1, luz saindo da boca).
 */
import { useId } from "react";
import type { Raridade } from "@/lib/jogos/tipos";
import { Monograma } from "../kit/IconePremio";
import css from "./caixas.module.css";

type Estilo = "black" | "gold" | "legend";

const PALETA: Record<Estilo, {
  frente: [string, string, string];
  lado: [string, string];
  topo: [string, string];
  tampaFrente: [string, string];
  aresta: string;
  largura: number;
  painel: number;
}> = {
  black: {
    frente: ["#2d2d32", "#17171a", "#0c0c0e"],
    lado: ["#141416", "#060607"],
    topo: ["#3c3c43", "#1c1c20"],
    tampaFrente: ["#323238", "#141416"],
    aresta: "#e6d3a3",
    largura: 1.2,
    painel: 0.35,
  },
  gold: {
    frente: ["#fff1b8", "#d9b257", "#8a6420"],
    lado: ["#a67c2e", "#4a360c"],
    topo: ["#fff6d8", "#d4af37"],
    tampaFrente: ["#f6e2a0", "#a67c2e"],
    aresta: "#5a420f",
    largura: 1.3,
    painel: 0.5,
  },
  legend: {
    frente: ["#18181b", "#0b0b0d", "#030304"],
    lado: ["#0c0c0e", "#020203"],
    topo: ["#2a2a30", "#0e0e10"],
    tampaFrente: ["#222227", "#0a0a0b"],
    aresta: "#ffe28c",
    largura: 1.8,
    painel: 0.75,
  },
};

export function estiloDaRaridade(r: Raridade): Estilo {
  return r === "LENDARIO" ? "legend" : r === "EPICO" ? "gold" : "black";
}

/** Arabesco de canto (quadrante superior esquerdo do painel); espelhado para os outros cantos. */
function Arabesco({ cor }: { cor: string }) {
  return (
    <g fill="none" stroke={cor} strokeWidth="1" strokeLinecap="round">
      <path d="M33 124c0-12 6-19 18-20" />
      <path d="M37 120c1-7 5-11 12-12" opacity=".7" />
      <path d="M51 104c3 0 5 2 4 4-1 1.6-3.4 1-3.2-.8" />
      <path d="M33 124c0 3-2 4-3.6 3.2-1.4-.8-.9-3 .6-3" />
      <path d="M40 104.5l2.2-2.2 2.2 2.2-2.2 2.2z" fill={cor} stroke="none" />
    </g>
  );
}

export function CaixaArte({ raridade, className = "", aura = true }: { raridade: Raridade; className?: string; aura?: boolean }) {
  const estilo = estiloDaRaridade(raridade);
  const c = PALETA[estilo];
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const u = (n: string) => `url(#${n}${id})`;
  const ouro = u("ouro");
  const legend = estilo === "legend";
  const gold = estilo === "gold";

  return (
    <div className={`${css.caixa} ${className}`} data-estilo={estilo}>
      {legend && aura && <div className={css.aura} aria-hidden />}
      <div className={css.raios} aria-hidden />

      {/* corpo */}
      <svg viewBox="0 30 200 165" className={css.camada} aria-hidden>
        <defs>
          <linearGradient id={`ouro${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fff3c4" />
            <stop offset=".3" stopColor="#e9c46a" />
            <stop offset=".6" stopColor="#a67c2e" />
            <stop offset=".8" stopColor="#f1d98c" />
            <stop offset="1" stopColor="#7a5a1e" />
          </linearGradient>
          <linearGradient id={`frente${id}`} x1="0" y1="0" x2={gold ? "1" : "0"} y2="1">
            <stop offset="0" stopColor={c.frente[0]} />
            <stop offset=".55" stopColor={c.frente[1]} />
            <stop offset="1" stopColor={c.frente[2]} />
          </linearGradient>
          <linearGradient id={`lado${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={c.lado[0]} />
            <stop offset="1" stopColor={c.lado[1]} />
          </linearGradient>
          <linearGradient id={`topo${id}`} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor={c.topo[0]} />
            <stop offset="1" stopColor={c.topo[1]} />
          </linearGradient>
          <linearGradient id={`tampaFrente${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={c.tampaFrente[0]} />
            <stop offset="1" stopColor={c.tampaFrente[1]} />
          </linearGradient>
          <linearGradient id={`reflexo${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity={gold ? ".55" : ".14"} />
            <stop offset=".35" stopColor="#fff" stopOpacity="0" />
            <stop offset=".62" stopColor="#fff" stopOpacity="0" />
            <stop offset=".72" stopColor="#fff" stopOpacity={gold ? ".3" : ".07"} />
            <stop offset=".85" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <radialGradient id={`dentro${id}`} cx=".5" cy=".6" r=".7">
            <stop offset="0" stopColor="#fffbe8" />
            <stop offset=".4" stopColor="#f1d98c" />
            <stop offset="1" stopColor="#a67c2e" stopOpacity=".2" />
          </radialGradient>
          <radialGradient id={`sombra${id}`} cx=".5" cy=".5" r=".5">
            <stop offset="0" stopColor="#000" stopOpacity=".75" />
            <stop offset="1" stopColor="#000" stopOpacity="0" />
          </radialGradient>
          <pattern id={`escovado${id}`} width="200" height="2.4" patternUnits="userSpaceOnUse">
            <rect width="200" height=".8" fill="#fff" opacity={gold ? ".08" : ".035"} />
          </pattern>
        </defs>

        <ellipse cx="100" cy="184" rx="86" ry="9" fill={u("sombra")} />

        {/* boca (aparece quando a tampa sai) */}
        <polygon points="24,92 58,70 176,70 142,92" fill="#050506" />
        <polygon points="24,92 58,70 176,70 142,92" fill={u("dentro")} style={{ opacity: "var(--aberta, 0)" }} />

        {/* lateral */}
        <polygon points="142,92 176,70 176,158 142,180" fill={u("lado")} />
        <polygon points="142,92 176,70 176,158 142,180" fill={u("escovado")} />

        {/* frente */}
        <rect x="24" y="92" width="118" height="88" fill={u("frente")} />
        <rect x="24" y="92" width="118" height="88" fill={u("escovado")} />
        <rect x="24" y="92" width="118" height="88" fill={u("reflexo")} />

        {/* arestas */}
        <g fill="none" stroke={c.aresta} strokeWidth={c.largura} strokeLinejoin="round">
          <path d="M24 92V180H142V92" />
          <path d="M142 180L176 158V70" />
        </g>
        <path d="M142 92V180" stroke="#fff" strokeOpacity={gold ? ".55" : ".18"} strokeWidth=".6" />

        {/* painel e emblema */}
        <rect x="32" y="101" width="102" height="71" rx="2" fill="none" stroke={legend ? ouro : c.aresta} strokeOpacity={c.painel} strokeWidth={legend ? 1.1 : 0.8} />
        {legend && (
          <>
            <rect x="35.5" y="104.5" width="95" height="64" rx="1.5" fill="none" stroke={ouro} strokeOpacity=".45" strokeWidth=".6" />
            <g>
              <Arabesco cor="#ffe28c" />
              <g transform="translate(166 0) scale(-1 1)"><Arabesco cor="#ffe28c" /></g>
              <g transform="translate(0 272) scale(1 -1)"><Arabesco cor="#ffe28c" /></g>
              <g transform="translate(166 272) scale(-1 -1)"><Arabesco cor="#ffe28c" /></g>
            </g>
            <path d="M148 112l22-14M148 132l22-14M148 152l22-14" stroke={ouro} strokeOpacity=".4" strokeWidth=".7" />
          </>
        )}
        <circle cx="83" cy="136" r="25" fill="none" stroke={ouro} strokeOpacity={gold ? ".9" : ".55"} strokeWidth=".8" />
        <g transform="translate(62 115)">
          <Monograma tamanho={42} />
        </g>

        {/* cantoneiras */}
        <g fill={ouro} stroke="#3a2a08" strokeWidth=".4">
          <path d="M24 167V180H37V176.8H27.2V167Z" />
          <path d="M142 167V180H129V176.8H138.8V167Z" />
          <path d="M176 145V158L166 164.5V160.8L172.8 156.4V145Z" />
        </g>
      </svg>

      <div className={css.coluna} aria-hidden />
      <div className={css.boca} aria-hidden />

      {/* tampa (sai voando na abertura) */}
      <div data-tampa className={css.tampa}>
        <svg viewBox="0 30 200 165" className={css.camada} aria-hidden>
          <polygon points="20,72 54,50 180,50 146,72" fill={u("topo")} />
          <polygon points="20,72 54,50 180,50 146,72" fill={u("escovado")} />
          <polygon points="146,72 180,50 180,72 146,94" fill={u("lado")} />
          <rect x="20" y="72" width="126" height="22" fill={u("tampaFrente")} />
          <rect x="20" y="72" width="126" height="22" fill={u("escovado")} />
          <rect x="20" y="72" width="126" height="22" fill={u("reflexo")} />
          <g fill="none" stroke={c.aresta} strokeWidth={c.largura} strokeLinejoin="round">
            <path d="M20 94V72L54 50H180V72L146 94H20" />
            <path d="M20 72H146L180 50M146 72V94" />
          </g>
          <path d="M20 72H146" stroke="#fff" strokeOpacity={gold ? ".7" : ".22"} strokeWidth=".6" />
          {/* losango no topo */}
          <path d="M70 61L88 68.7L130 61L112 53.3Z" fill="none" stroke={legend ? "#ffe28c" : c.aresta} strokeOpacity={legend ? ".9" : ".35"} strokeWidth={legend ? 1.1 : 0.7} />
          {legend && <path d="M84 61L93 64.9L116 61L107 57.1Z" fill={ouro} opacity=".85" />}
          <g fill={ouro} stroke="#3a2a08" strokeWidth=".4">
            <path d="M20 72H32V74.8H22.8V84H20Z" />
            <path d="M146 72H134V74.8H143.2V84H146Z" />
            <path d="M180 50H168V52.4H177.6V62H180Z" />
            {/* fecho */}
            <rect x="75" y="86" width="16" height="15" rx="2" />
          </g>
          <circle cx="83" cy="92.5" r="1.8" fill="#0b0b0c" />
          <path d="M83 93.5V97" stroke="#0b0b0c" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </div>

      {/* fresta: luz vazando entre tampa e corpo */}
      <svg viewBox="0 30 200 165" className={`${css.camada} ${css.fenda}`} aria-hidden>
        <defs>
          <filter id={`borrar${id}`} x="-20%" y="-50%" width="140%" height="200%">
            <feGaussianBlur stdDeviation="4" />
          </filter>
        </defs>
        <path d="M24 94H142L176 72" fill="none" stroke="#e9c46a" strokeWidth="9" filter={u("borrar")} />
        <path d="M24 94H142L176 72" fill="none" stroke="#fff6d8" strokeWidth="2" strokeLinecap="round" />
        <path d="M83 101v-7" stroke="#fff6d8" strokeWidth="1.2" opacity=".8" />
      </svg>
    </div>
  );
}
