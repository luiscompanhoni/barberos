"use client";

/**
 * A roda da roleta (SVG): aro metalico com luzes, fatias coloridas com o texto no sentido do raio,
 * ponteiro dourado no topo e o botao central. Usada no jogo do cliente e na previa do painel.
 */

export type Fatia = { id: string; rotulo: string; cor: string };

const C = 200;
const R_FATIA = 166;
const LUZES = 24;

function ponto(r: number, graus: number) {
  const a = ((graus - 90) * Math.PI) / 180;
  return [C + r * Math.cos(a), C + r * Math.sin(a)] as const;
}

function caminho(i: number, n: number) {
  const seg = 360 / n;
  const [x0, y0] = ponto(R_FATIA, i * seg);
  const [x1, y1] = ponto(R_FATIA, (i + 1) * seg);
  return `M${C},${C} L${x0},${y0} A${R_FATIA},${R_FATIA} 0 ${seg > 180 ? 1 : 0} 1 ${x1},${y1} Z`;
}

/** Quebra o rotulo em ate 2 linhas (valor em destaque em cima). */
function linhas(rotulo: string): [string, string?] {
  const t = rotulo.trim();
  if (t.length <= 9) return [t];
  const meio = t.lastIndexOf(" ", Math.ceil(t.length / 2) + 2);
  return meio > 0 ? [t.slice(0, meio), t.slice(meio + 1)] : [t];
}

export function RodaRoleta({ fatias, rotacao, girando, destaque, onGirar, podeGirar, rotuloBotao = "GIRAR", aoParar }: {
  fatias: Fatia[];
  rotacao: number;
  girando?: boolean;
  destaque?: number | null;
  onGirar?: () => void;
  podeGirar?: boolean;
  rotuloBotao?: string;
  aoParar?: () => void;
}) {
  const n = Math.max(fatias.length, 1);
  const seg = 360 / n;
  const fonte = n > 12 ? 13 : n > 9 ? 15 : 17;

  return (
    <div className="relative mx-auto aspect-square w-full max-w-[360px] select-none">
      {/* aro metalico + luzes (fixo) */}
      <svg viewBox="0 0 400 400" className="absolute inset-0 h-full w-full drop-shadow-[0_8px_18px_rgba(0,0,0,.6)]">
        <defs>
          <radialGradient id="aro" cx="50%" cy="40%" r="60%">
            <stop offset="0%" stopColor="#5b6b7c" />
            <stop offset="70%" stopColor="#26323f" />
            <stop offset="100%" stopColor="#0c1218" />
          </radialGradient>
          <linearGradient id="aroBrilho" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#c9d3dd" />
            <stop offset="50%" stopColor="#6f7f8f" />
            <stop offset="100%" stopColor="#c9d3dd" />
          </linearGradient>
        </defs>
        <circle cx={C} cy={C} r={198} fill="url(#aroBrilho)" />
        <circle cx={C} cy={C} r={192} fill="url(#aro)" />
        <circle cx={C} cy={C} r={171} fill="#0b1117" />
        {Array.from({ length: LUZES }, (_, i) => {
          const [x, y] = ponto(181.5, (i * 360) / LUZES + 360 / LUZES / 2);
          return <circle key={i} cx={x} cy={y} r={4.6} className={`roleta-luz ${i % 2 ? "roleta-luz-b" : ""} ${girando ? "roleta-luz-rapida" : ""}`} />;
        })}
      </svg>

      {/* fatias (giram) */}
      <div
        className="absolute inset-0"
        style={{ transform: `rotate(${rotacao}deg)`, transition: girando ? "transform 5.6s cubic-bezier(0.12, 0.78, 0.16, 1)" : "none" }}
        onTransitionEnd={aoParar}
      >
        <svg viewBox="0 0 400 400" className="h-full w-full">
          <defs>
            <radialGradient id="sombraFatia" cx="50%" cy="50%" r="50%">
              <stop offset="55%" stopColor="#000" stopOpacity="0" />
              <stop offset="100%" stopColor="#000" stopOpacity="0.28" />
            </radialGradient>
          </defs>
          {fatias.map((f, i) => (
            <path key={f.id + i} d={caminho(i, n)} fill={f.cor} stroke="#0b1117" strokeWidth={2.2}
              className={destaque === i ? "roleta-fatia-ganha" : undefined} />
          ))}
          <circle cx={C} cy={C} r={R_FATIA} fill="url(#sombraFatia)" pointerEvents="none" />
          {fatias.map((f, i) => {
            const [l1, l2] = linhas(f.rotulo);
            const meio = i * seg + seg / 2;
            return (
              <g key={`t${f.id}${i}`} transform={`rotate(${meio} ${C} ${C})`}>
                <text x={C} y={C - 108} transform={`rotate(90 ${C} ${C - 108})`} textAnchor="middle" dominantBaseline="middle"
                  className="roleta-texto" fontSize={fonte}>
                  {l2 ? (
                    <>
                      <tspan x={C} dy="-0.55em">{l1}</tspan>
                      <tspan x={C} dy="1.1em" fontSize={fonte * 0.82}>{l2}</tspan>
                    </>
                  ) : l1}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* ponteiro (fixo, no topo) */}
      <svg viewBox="0 0 60 80" className="absolute left-1/2 top-[-3%] z-10 w-[13%] -translate-x-1/2 drop-shadow-[0_3px_3px_rgba(0,0,0,.6)]">
        <defs>
          <linearGradient id="pino" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#fff3b0" />
            <stop offset="45%" stopColor="#f5c000" />
            <stop offset="100%" stopColor="#a86f00" />
          </linearGradient>
        </defs>
        <path d="M30 78 L8 34 A24 24 0 1 1 52 34 Z" fill="url(#pino)" stroke="#6b4600" strokeWidth="2" />
        <circle cx="30" cy="27" r="14" fill="#14181d" stroke="#2c333b" strokeWidth="2" />
        <circle cx="30" cy="27" r="7.5" fill="#fff" />
        <text x="30" y="28" textAnchor="middle" dominantBaseline="middle" fontSize="10" fontWeight="900" fill="#14181d">B</text>
      </svg>

      {/* botao central */}
      <button
        type="button"
        onClick={onGirar}
        disabled={!onGirar || !podeGirar || girando}
        className="roleta-botao absolute left-1/2 top-1/2 z-10 grid aspect-square w-[26%] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full"
        aria-label="Girar a roleta"
      >
        <span className="roleta-botao-texto">{rotuloBotao}</span>
      </button>
    </div>
  );
}

/** Rotacao final para a fatia `indice` parar embaixo do ponteiro, com voltas extras e um desvio aleatorio. */
export function rotacaoAlvo(atual: number, indice: number, n: number, desvio = 0) {
  const seg = 360 / n;
  const alvo = 360 - (indice * seg + seg / 2) + desvio * seg * 0.32;
  const base = atual - (((atual % 360) + 360) % 360);
  return base + 360 * 7 + ((alvo % 360) + 360) % 360;
}
