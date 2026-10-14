"use client";

/**
 * Camada de particulas (canvas por cima do jogo): faiscas douradas, confete, fichas, fumaca e brilhos.
 * Um laco de requestAnimationFrame so enquanto ha particula viva; resolucao limitada a 2x para celular medio.
 * Com "reduzir movimento", solta bem menos particulas.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import { useMovimentoReduzido } from "./useMovimentoReduzido";

export type TipoParticula = "faisca" | "confete" | "ficha" | "fumaca" | "brilho";
export type Disparo = { x: number; y: number; tipo: TipoParticula; quantidade?: number; forca?: number; cores?: string[]; espalhar?: number };
export type ParticulasRef = { disparar: (d: Disparo) => void; limpar: () => void };

type P = {
  tipo: TipoParticula; x: number; y: number; vx: number; vy: number; vida: number; max: number;
  tam: number; cor: string; giro: number; vg: number; gravidade: number; arrasto: number;
};

export const OURO = ["#F6E7B0", "#E9C46A", "#C9A24A", "#A67C2E", "#FFF6D8"];
const CONFETE = ["#E9C46A", "#C9A24A", "#F5F5F5", "#3A3A3F", "#FFF6D8"];

export const Particulas = forwardRef<ParticulasRef, { className?: string }>(function Particulas({ className }, ref) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const ps = useRef<P[]>([]);
  const laco = useRef<number | null>(null);
  const reduzido = useMovimentoReduzido();

  const desenhar = useCallback(() => {
    const c = canvas.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = c.clientWidth, h = c.clientHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const vivas: P[] = [];
    for (const p of ps.current) {
      p.vida++;
      if (p.vida > p.max) continue;
      p.vx *= p.arrasto; p.vy = p.vy * p.arrasto + p.gravidade;
      p.x += p.vx; p.y += p.vy; p.giro += p.vg;
      const t = p.vida / p.max;
      const alfa = p.tipo === "fumaca" ? 0.22 * (1 - t) : t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
      ctx.globalAlpha = Math.max(0, alfa);
      if (p.tipo === "faisca") {
        ctx.strokeStyle = p.cor; ctx.lineWidth = p.tam; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 2.2, p.y - p.vy * 2.2); ctx.stroke();
      } else if (p.tipo === "confete") {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.giro); ctx.scale(1, Math.cos(p.giro * 1.7));
        ctx.fillStyle = p.cor; ctx.fillRect(-p.tam, -p.tam * 0.45, p.tam * 2, p.tam * 0.9); ctx.restore();
      } else if (p.tipo === "ficha") {
        ctx.save(); ctx.translate(p.x, p.y); ctx.scale(Math.abs(Math.cos(p.giro)) * 0.85 + 0.15, 1);
        const g = ctx.createLinearGradient(-p.tam, -p.tam, p.tam, p.tam);
        g.addColorStop(0, "#FFF3C4"); g.addColorStop(0.5, "#D4AF37"); g.addColorStop(1, "#7A5A1E");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, p.tam, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "rgba(60,40,10,.6)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, p.tam * 0.68, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      } else if (p.tipo === "fumaca") {
        const r = p.tam * (1 + t * 2.2);
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        g.addColorStop(0, "rgba(200,200,205,.9)"); g.addColorStop(1, "rgba(200,200,205,0)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
      } else {
        // brilho: estrela de 4 pontas
        const r = p.tam * (t < 0.5 ? t * 2 : (1 - t) * 2);
        ctx.fillStyle = p.cor; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.giro);
        ctx.beginPath();
        for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4; const rr = i % 2 ? r * 0.28 : r; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
        ctx.closePath(); ctx.fill(); ctx.restore();
      }
      vivas.push(p);
    }
    ctx.globalAlpha = 1;
    ps.current = vivas;
    laco.current = vivas.length ? requestAnimationFrame(desenhar) : null;
  }, []);

  useImperativeHandle(ref, () => ({
    disparar: (d) => {
      const base = d.quantidade ?? ({ faisca: 40, confete: 60, ficha: 22, fumaca: 10, brilho: 14 } as const)[d.tipo];
      const n = Math.max(1, Math.round(base * (reduzido ? 0.25 : 1)));
      const forca = d.forca ?? 1;
      const cores = d.cores ?? (d.tipo === "confete" ? CONFETE : OURO);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = (d.tipo === "fumaca" ? 0.6 : d.tipo === "brilho" ? 0.4 : 3 + Math.random() * 6) * forca;
        const esp = d.espalhar ?? 0;
        ps.current.push({
          tipo: d.tipo,
          x: d.x + (Math.random() - 0.5) * esp, y: d.y + (Math.random() - 0.5) * esp,
          vx: Math.cos(a) * v, vy: Math.sin(a) * v - (d.tipo === "confete" || d.tipo === "ficha" ? 4 * forca : 0),
          vida: 0,
          max: { faisca: 38, confete: 110, ficha: 80, fumaca: 90, brilho: 45 }[d.tipo] + Math.random() * 25,
          tam: { faisca: 2, confete: 5, ficha: 9, fumaca: 26, brilho: 9 }[d.tipo] * (0.7 + Math.random() * 0.6),
          cor: cores[i % cores.length], giro: Math.random() * 6, vg: (Math.random() - 0.5) * 0.3,
          gravidade: { faisca: 0.12, confete: 0.11, ficha: 0.28, fumaca: -0.02, brilho: 0 }[d.tipo],
          arrasto: { faisca: 0.95, confete: 0.985, ficha: 0.99, fumaca: 0.97, brilho: 0.9 }[d.tipo],
        });
      }
      if (laco.current === null) laco.current = requestAnimationFrame(desenhar);
    },
    limpar: () => { ps.current = []; },
  }), [desenhar, reduzido]);

  useEffect(() => () => { if (laco.current !== null) cancelAnimationFrame(laco.current); }, []);

  return <canvas ref={canvas} aria-hidden className={`pointer-events-none absolute inset-0 h-full w-full ${className ?? ""}`} />;
});
