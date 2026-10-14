/**
 * Pelicula da Raspadinha Black: grafite escovado, filete dourado e selo "BB" gravado (arte original, em canvas).
 * Tambem a conta da area raspada: grade de pontos por celula marcada pela geometria do traco
 * (sem getImageData, que trava a GPU no celular).
 */

export type Ret = { x: number; y: number; w: number; h: number };

/** Pontos por lado na grade de amostragem de cada celula. */
export const AMOSTRAS = 10;
const N = AMOSTRAS;

let texturaCache: HTMLCanvasElement | null = null;

/** Faixa de metal escovado (linhas horizontais finas), gerada uma vez. */
function textura() {
  if (texturaCache) return texturaCache;
  const c = document.createElement("canvas");
  c.width = 192; c.height = 192;
  const g = c.getContext("2d");
  if (g) {
    for (let y = 0; y < c.height; y++) {
      const claro = Math.random() < 0.45;
      g.fillStyle = claro ? `rgba(255,255,255,${(Math.random() * 0.055).toFixed(3)})` : `rgba(0,0,0,${(0.04 + Math.random() * 0.16).toFixed(3)})`;
      const x0 = Math.random() * 60 - 30;
      const len = 70 + Math.random() * 150;
      g.fillRect(x0, y, len, 1);
      g.fillRect(x0 + len + 8 + Math.random() * 24, y, c.width, 1);
    }
  }
  texturaCache = c;
  return c;
}

function caminho(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function ouro(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, "#FFF3C4");
  g.addColorStop(0.28, "#E9C46A");
  g.addColorStop(0.55, "#A67C2E");
  g.addColorStop(0.8, "#F1D98C");
  g.addColorStop(1, "#7A5A1E");
  return g;
}

function peca(ctx: CanvasRenderingContext2D, r: Ret, padrao: CanvasPattern | null) {
  const { x, y, w, h } = r;
  const raio = Math.min(w, h) * 0.12;

  // base grafite
  const base = ctx.createLinearGradient(x, y, x + w, y + h);
  base.addColorStop(0, "#37373d");
  base.addColorStop(0.42, "#1b1b1f");
  base.addColorStop(0.68, "#2c2c31");
  base.addColorStop(1, "#121215");
  caminho(ctx, x, y, w, h, raio);
  ctx.fillStyle = base;
  ctx.fill();

  ctx.save();
  caminho(ctx, x, y, w, h, raio);
  ctx.clip();
  // escovado
  if (padrao) {
    ctx.fillStyle = padrao;
    ctx.fillRect(x, y, w, h);
  }
  // reflexo diagonal
  const reflexo = ctx.createLinearGradient(x, y + h, x + w, y);
  reflexo.addColorStop(0.25, "rgba(255,255,255,0)");
  reflexo.addColorStop(0.5, "rgba(255,248,225,0.09)");
  reflexo.addColorStop(0.75, "rgba(255,255,255,0)");
  ctx.fillStyle = reflexo;
  ctx.fillRect(x, y, w, h);
  // vinheta
  const vin = ctx.createRadialGradient(x + w / 2, y + h / 2, Math.min(w, h) * 0.2, x + w / 2, y + h / 2, Math.max(w, h) * 0.75);
  vin.addColorStop(0, "rgba(0,0,0,0)");
  vin.addColorStop(1, "rgba(0,0,0,0.42)");
  ctx.fillStyle = vin;
  ctx.fillRect(x, y, w, h);

  // selo BB gravado
  const cx = x + w / 2, cy = y + h / 2, R = Math.min(w, h) * 0.25;
  const dourado = ouro(ctx, cx - R, cy - R, R * 2, R * 2);
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.beginPath(); ctx.arc(cx + 0.8, cy + 0.8, R, 0, Math.PI * 2); ctx.stroke();
  ctx.globalAlpha = 0.6;
  ctx.strokeStyle = dourado;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
  ctx.globalAlpha = 0.3;
  ctx.lineWidth = 0.6;
  ctx.beginPath(); ctx.arc(cx, cy, R * 0.82, 0, Math.PI * 2); ctx.stroke();
  // filetes laterais
  ctx.globalAlpha = 0.28;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(cx - R * 1.7, cy); ctx.lineTo(cx - R * 1.18, cy);
  ctx.moveTo(cx + R * 1.18, cy); ctx.lineTo(cx + R * 1.7, cy);
  ctx.stroke();
  // letras
  ctx.font = `900 ${Math.round(R * 0.92)}px Georgia, 'Times New Roman', serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = "#000";
  ctx.fillText("BB", cx + 1, cy + 1.5);
  ctx.globalAlpha = 0.72;
  ctx.fillStyle = dourado;
  ctx.fillText("BB", cx, cy + 0.5);
  ctx.globalAlpha = 1;
  ctx.restore();

  // filete dourado da borda
  const borda = ouro(ctx, x, y, w, h);
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = borda;
  ctx.globalAlpha = 0.85;
  caminho(ctx, x + 0.7, y + 0.7, w - 1.4, h - 1.4, raio);
  ctx.stroke();
  ctx.globalAlpha = 0.22;
  ctx.lineWidth = 0.6;
  caminho(ctx, x + 4.5, y + 4.5, w - 9, h - 9, raio * 0.7);
  ctx.stroke();
  // losangos nos cantos
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = borda;
  const d = 2.2, m = 9;
  for (const [px, py] of [[x + m, y + m], [x + w - m, y + m], [x + m, y + h - m], [x + w - m, y + h - m]]) {
    ctx.beginPath();
    ctx.moveTo(px, py - d); ctx.lineTo(px + d, py); ctx.lineTo(px, py + d); ctx.lineTo(px - d, py);
    ctx.closePath(); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** Desenha as 9 pecas cobertas (contexto ja em px de CSS). */
export function desenharFolha(ctx: CanvasRenderingContext2D, rets: Ret[]) {
  const padrao = ctx.createPattern(textura(), "repeat");
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  for (const r of rets) peca(ctx, r, padrao);
}

/** Marca os pontos da celula cobertos pelo traco a->b de raio `raio`. Devolve quantos pontos novos. */
export function marcarSegmento(cob: Uint8Array, r: Ret, ax: number, ay: number, bx: number, by: number, raio: number) {
  if (Math.max(ax, bx) + raio < r.x || Math.min(ax, bx) - raio > r.x + r.w) return 0;
  if (Math.max(ay, by) + raio < r.y || Math.min(ay, by) - raio > r.y + r.h) return 0;
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, r2 = raio * raio;
  const passoX = r.w / N, passoY = r.h / N;
  let novos = 0;
  for (let gy = 0; gy < N; gy++) {
    const py = r.y + (gy + 0.5) * passoY;
    for (let gx = 0; gx < N; gx++) {
      const k = gy * N + gx;
      if (cob[k]) continue;
      const px = r.x + (gx + 0.5) * passoX;
      let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = ax + t * dx - px, ey = ay + t * dy - py;
      if (ex * ex + ey * ey <= r2) { cob[k] = 1; novos++; }
    }
  }
  return novos;
}
