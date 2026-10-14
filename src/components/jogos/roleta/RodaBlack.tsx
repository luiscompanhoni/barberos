"use client";

/**
 * Roda da Roleta Black (SVG). A rotacao e feita por requestAnimationFrame com perfil proprio:
 * arranca (0,6 s) -> velocidade alta (1 s) -> desacelera devagar (3,9 s) e para EXATAMENTE na fatia decidida
 * pelo servidor. Cada divisao que passa pelo ponteiro gera tick, mexe o ponteiro e (devagar) vibra.
 * Nada de estado React por quadro: transform direto no elemento.
 */
import { forwardRef, useImperativeHandle, useRef } from "react";
import type { FatiaRoleta } from "@/lib/jogos/tipos";
import { IconePremio, Monograma } from "../kit/IconePremio";

export type RodaRef = {
  /** Gira ate a fatia `indice`. `aoPassar(velocidade 0..1)` a cada divisao; `aoVelocidade` a cada quadro. */
  girarAte: (indice: number, o: { reduzido?: boolean; aoPassar?: (v: number) => void; aoVelocidade?: (v: number) => void }) => Promise<void>;
  /** Volta ao repouso sem animar (nova jogada). */
  parado: () => void;
};

const C = 200;
const R = 168;
const LUZES = 28;

const ponto = (r: number, graus: number) => {
  const a = ((graus - 90) * Math.PI) / 180;
  return [C + r * Math.cos(a), C + r * Math.sin(a)] as const;
};
function fatiaPath(i: number, n: number) {
  const seg = 360 / n;
  const [x0, y0] = ponto(R, i * seg);
  const [x1, y1] = ponto(R, (i + 1) * seg);
  return `M${C},${C} L${x0},${y0} A${R},${R} 0 ${seg > 180 ? 1 : 0} 1 ${x1},${y1} Z`;
}
/** Texto escuro em fatia clara (ouro/champanhe), claro na escura. */
function textoEscuro(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 150;
}
function quebrar(rotulo: string): [string, string?] {
  const t = rotulo.trim();
  if (t.length <= 10) return [t];
  const meio = t.lastIndexOf(" ", Math.ceil(t.length / 2) + 2);
  return meio > 0 ? [t.slice(0, meio), t.slice(meio + 1)] : [t];
}

// Perfil de velocidade (segundos)
const T_ARRANQUE = 0.6;
const T_CRUZEIRO = 1.0;
const T_FREIO = 3.9;
const POTENCIA = 3; // freio: v = vmax * (1-u)^3

export const RodaBlack = forwardRef<RodaRef, {
  fatias: FatiaRoleta[];
  girando?: boolean;
  vencedora?: number | null;
  podeGirar?: boolean;
  aoGirar?: () => void;
  rotuloBotao?: string;
}>(function RodaBlack({ fatias, girando = false, vencedora = null, podeGirar = false, aoGirar, rotuloBotao = "GIRAR" }, ref) {
  const roda = useRef<HTMLDivElement>(null);
  const ponteiro = useRef<SVGGElement>(null);
  const angulo = useRef(0);
  const n = Math.max(fatias.length, 1);
  const seg = 360 / n;
  const fonte = n > 12 ? 12.5 : n > 9 ? 14 : 16;

  const aplicar = (a: number) => { if (roda.current) roda.current.style.transform = `rotate(${a}deg)`; };
  const balancarPonteiro = (forca: number) => {
    const p = ponteiro.current;
    if (!p) return;
    p.animate([{ transform: `rotate(${-10 - 16 * forca}deg)` }, { transform: "rotate(0deg)" }], { duration: 90 + 120 * forca, easing: "cubic-bezier(.3,1.6,.5,1)" });
  };

  useImperativeHandle(ref, () => ({
    parado: () => { angulo.current %= 360; aplicar(angulo.current); },
    girarAte: (indice, o) => new Promise<void>((pronto) => {
      const inicio = angulo.current;
      // Ponto do premio: centro da fatia com um desvio (nao para sempre no meio), sempre longe da borda.
      const desvio = (Math.random() * 2 - 1) * seg * 0.3;
      const alvoMod = (((-(indice * seg + seg / 2 + desvio)) % 360) + 360) % 360;
      const atualMod = ((inicio % 360) + 360) % 360;
      const reduzido = !!o.reduzido;
      const voltas = reduzido ? 1 : 5;
      const D = voltas * 360 + ((alvoMod - atualMod + 360) % 360);
      const tA = reduzido ? 0 : T_ARRANQUE, tC = reduzido ? 0 : T_CRUZEIRO, tF = reduzido ? 1.2 : T_FREIO;
      const vmax = D / (tA / 2 + tC + tF / (POTENCIA + 1));
      const total = tA + tC + tF;
      // Distancia percorrida ate o tempo t (integral do perfil de velocidade).
      const dist = (t: number) => {
        if (t <= tA) return (vmax * t * t) / (2 * tA || 1);
        const dA = (vmax * tA) / 2;
        if (t <= tA + tC) return dA + vmax * (t - tA);
        const u = Math.min(1, (t - tA - tC) / tF);
        return dA + vmax * tC + ((vmax * tF) / (POTENCIA + 1)) * (1 - (1 - u) ** (POTENCIA + 1));
      };
      const vel = (t: number) => (t <= tA ? (vmax * t) / (tA || 1) : t <= tA + tC ? vmax : vmax * (1 - Math.min(1, (t - tA - tC) / tF)) ** POTENCIA);
      // Divisoes: o ponteiro (topo) cruza uma divisao quando o angulo percorrido passa por um multiplo de `seg`
      // contado a partir da posicao inicial das bordas.
      let ultimaDivisao = Math.floor((inicio + 0.0001) / seg);
      const t0 = performance.now();
      const quadro = (agora: number) => {
        const t = Math.min(total, (agora - t0) / 1000);
        const a = inicio + dist(t);
        angulo.current = a;
        aplicar(a);
        const v = vel(t) / vmax;
        o.aoVelocidade?.(v);
        const div = Math.floor((a + 0.0001) / seg);
        if (div !== ultimaDivisao) {
          ultimaDivisao = div;
          o.aoPassar?.(v);
          if (!reduzido) balancarPonteiro(1 - v * 0.8);
        }
        if (t < total) requestAnimationFrame(quadro);
        else { angulo.current = inicio + D; aplicar(angulo.current); o.aoVelocidade?.(0); pronto(); }
      };
      requestAnimationFrame(quadro);
    }),
  }), [seg]);

  return (
    <div className="relative mx-auto aspect-square w-full max-w-[400px] select-none">
      {/* halo dourado atras da roda */}
      <div aria-hidden className={`absolute inset-[6%] rounded-full transition-opacity duration-700 ${girando ? "opacity-90" : "opacity-50"}`}
        style={{ background: "radial-gradient(circle, rgba(233,196,106,.35) 0%, rgba(233,196,106,0) 68%)", filter: "blur(18px)" }} />

      {/* aro metalico com luzes (fixo) */}
      <svg viewBox="0 0 400 400" className="absolute inset-0 h-full w-full drop-shadow-[0_14px_28px_rgba(0,0,0,.75)]" aria-hidden>
        <defs>
          <linearGradient id="rb-aro" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#FFF3C4" />
            <stop offset=".25" stopColor="#C9A24A" />
            <stop offset=".5" stopColor="#5E4518" />
            <stop offset=".72" stopColor="#E9C46A" />
            <stop offset="1" stopColor="#6B4E17" />
          </linearGradient>
          <radialGradient id="rb-aro-interno" cx="50%" cy="45%" r="55%">
            <stop offset="0" stopColor="#2a2a2e" />
            <stop offset="1" stopColor="#09090a" />
          </radialGradient>
        </defs>
        <circle cx={C} cy={C} r={199} fill="url(#rb-aro)" />
        <circle cx={C} cy={C} r={192} fill="url(#rb-aro-interno)" />
        <circle cx={C} cy={C} r={192} fill="none" stroke="rgba(255,243,196,.25)" strokeWidth="1" />
        <circle cx={C} cy={C} r={172} fill="url(#rb-aro)" />
        {Array.from({ length: LUZES }, (_, i) => {
          const [x, y] = ponto(182, (i * 360) / LUZES);
          return <circle key={i} cx={x} cy={y} r={3.6} className={`rb-luz ${girando ? "rb-luz-rapida" : ""}`} style={{ animationDelay: `${(i % 4) * (girando ? 0.06 : 0.3)}s` }} />;
        })}
      </svg>

      {/* fatias (giram) */}
      <div ref={roda} className="absolute inset-0 will-change-transform">
        <svg viewBox="0 0 400 400" className="h-full w-full">
          <defs>
            <radialGradient id="rb-sombra" cx="50%" cy="50%" r="50%">
              <stop offset=".45" stopColor="#000" stopOpacity="0" />
              <stop offset="1" stopColor="#000" stopOpacity=".45" />
            </radialGradient>
            <linearGradient id="rb-brilho-fatia" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#fff" stopOpacity=".16" />
              <stop offset=".5" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
          </defs>
          {fatias.map((f, i) => <path key={`${f.id}${i}`} d={fatiaPath(i, n)} fill={f.cor} />)}
          <circle cx={C} cy={C} r={R} fill="url(#rb-brilho-fatia)" pointerEvents="none" />
          <circle cx={C} cy={C} r={R} fill="url(#rb-sombra)" pointerEvents="none" />
          {/* divisorias douradas */}
          {fatias.map((_, i) => {
            const [x, y] = ponto(R, i * seg);
            return <line key={`d${i}`} x1={C} y1={C} x2={x} y2={y} stroke="#E9C46A" strokeOpacity=".75" strokeWidth="1.6" />;
          })}
          {/* destaque da fatia vencedora */}
          {vencedora !== null && <path d={fatiaPath(vencedora, n)} className="rb-vencedora" />}
          {fatias.map((f, i) => {
            const [l1, l2] = quebrar(f.rotulo);
            const meio = i * seg + seg / 2;
            const escuro = textoEscuro(f.cor);
            const cor = escuro ? "#17120a" : "#F6E7B0";
            return (
              <g key={`t${f.id}${i}`} transform={`rotate(${meio} ${C} ${C})`}>
                <g transform={`translate(${C - 9} ${C - R + 14})`} color={escuro ? "#3a2a0c" : "#E9C46A"}>
                  <IconePremio icone={f.icone} tamanho={18} traco={1.8} />
                </g>
                <text x={C} y={C - R + 50} textAnchor="middle" dominantBaseline="middle" fill={cor} fontSize={fonte} fontWeight={900}
                  style={{ letterSpacing: "-0.01em", paintOrder: "stroke", stroke: escuro ? "rgba(255,255,255,.25)" : "rgba(0,0,0,.55)", strokeWidth: 2.5 }}>
                  {l2 ? (<><tspan x={C} dy="-0.5em">{l1}</tspan><tspan x={C} dy="1.08em" fontSize={fonte * 0.8}>{l2}</tspan></>) : l1}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* ponteiro (fixo no topo; balanca a cada divisao) */}
      <svg viewBox="0 0 60 84" className="absolute left-1/2 top-[-4%] z-10 w-[13%] -translate-x-1/2 drop-shadow-[0_4px_4px_rgba(0,0,0,.7)]" aria-hidden>
        <defs>
          <linearGradient id="rb-pino" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#FFF3C4" />
            <stop offset=".45" stopColor="#D4AF37" />
            <stop offset="1" stopColor="#6B4E17" />
          </linearGradient>
        </defs>
        <g ref={ponteiro} style={{ transformOrigin: "30px 26px", transformBox: "view-box" }}>
          <path d="M30 82 L10 34 A22 22 0 1 1 50 34 Z" fill="url(#rb-pino)" stroke="#3d2c0a" strokeWidth="1.5" />
          <circle cx="30" cy="26" r="12" fill="#0B0B0C" stroke="#E9C46A" strokeWidth="1.5" />
          <circle cx="30" cy="26" r="4" fill="#E9C46A" />
        </g>
      </svg>

      {/* botao central GIRAR */}
      <button type="button" onClick={aoGirar} disabled={!podeGirar || girando}
        className="rb-botao absolute left-1/2 top-1/2 z-10 grid aspect-square w-[27%] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full"
        aria-label="Girar a roleta">
        <span className="flex flex-col items-center leading-none">
          <Monograma tamanho={26} className="mb-1 opacity-90" />
          <span className="rb-botao-texto">{girando ? "···" : rotuloBotao}</span>
        </span>
      </button>
    </div>
  );
});
