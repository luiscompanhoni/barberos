"use client";

/**
 * A cartela 3x3 com a pelicula raspavel (um canvas so por cima da grade).
 * Tudo que acontece a cada movimento do dedo fica em variaveis do efeito + requestAnimationFrame:
 * o React so e avisado quando uma celula abre (no maximo 9 vezes) e no fim.
 * Os simbolos so aparecem embaixo depois que a jogada chegou do servidor.
 */
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { JogadaCliente } from "@/lib/jogos/tipos";
import { IconePremio } from "../kit/IconePremio";
import type { ParticulasRef } from "../kit/Particulas";
import { som, vibrar, type Continuo } from "../kit/som";
import { AMOSTRAS, desenharFolha, marcarSegmento, type Ret } from "./folha";
import css from "./raspadinha.module.css";

/** Celula abre sozinha com 55% raspado. */
const LIMIAR_CELULA = 0.55;
/** Cartela inteira abre com 60% raspado no total. */
const LIMIAR_TOTAL = 0.6;
/** Conta da area raspada no maximo a cada 120 ms. */
const VERIFICAR_MS = 120;
const FADE_TOTAL_MS = 350;
const FADE_REVELAR_MS = 260;
/** Quadros do esmaecer de uma celula (~110 ms a 60 fps). */
const PASSOS_CELULA = 7;
const PONTOS = AMOSTRAS * AMOSTRAS;
const ISCAS = new Set(["tesoura", "navalha", "pente", "poste", "bigode"]);
const RESIDUO = ["#2a2a2e", "#3a3a3f", "#151518", "#C9A24A", "#E9C46A"];
const TODAS = 511;

export type CartaRaspavelRef = {
  /** Comeca a jogada sem raspar (botao "Raspar"). */
  iniciar: () => void;
  /** Acessibilidade: revela tudo com um esmaecer curto. */
  revelarTudo: () => void;
  /** Chuva de ouro saindo das celulas vencedoras. */
  celebrar: (vencedoras: number[]) => void;
};

type Props = {
  jogada: JogadaCliente | null;
  habilitado: boolean;
  reduzido: boolean;
  resultado: "vitoria" | "derrota" | null;
  aoTocar: () => void;
  aoCompletar: () => void;
  particulas: RefObject<ParticulasRef | null>;
  palco: RefObject<HTMLElement | null>;
};

type Api = CartaRaspavelRef & { acordar: () => void };

export const CartaRaspavel = forwardRef<CartaRaspavelRef, Props>(function CartaRaspavel(props, ref) {
  const { jogada, resultado } = props;
  const gradeRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const celulas = useRef<(HTMLDivElement | null)[]>([]);
  const atual = useRef(props);
  const api = useRef<Api | null>(null);
  const [abertas, setAbertas] = useState(0);

  useLayoutEffect(() => { atual.current = props; });

  useImperativeHandle(ref, () => ({
    iniciar: () => api.current?.iniciar(),
    revelarTudo: () => api.current?.revelarTudo(),
    celebrar: (v) => api.current?.celebrar(v),
  }), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const grade = gradeRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !grade || !ctx) return;

    let W = 0, H = 0, raio = 15;
    let rets: Ret[] = [];
    const cob = Array.from({ length: 9 }, () => new Uint8Array(PONTOS));
    const cont = new Array<number>(9).fill(0);
    const abertasM = new Array<boolean>(9).fill(false);
    const segs: number[] = []; // normalizado (0..1) para redesenhar se o tamanho mudar
    let fila: number[] = []; // em px, a desenhar no proximo quadro
    const fades: { i: number; passos: number }[] = [];
    let raf = 0, ultimaVerif = 0, sujo = false, completo = false, pedidoRevelar = false, tocou = false;
    let arrastando = false, idPonteiro = -1;
    let ultX = 0, ultY = 0, ultT = 0;
    let rasp: Continuo | null = null;
    let inicioToque = 0, ultMov = 0, ultPart = 0, ultVib = 0;
    let caixa = canvas.getBoundingClientRect();
    let palcoDx = 0, palcoDy = 0;
    const timers: number[] = [];

    const offsetPalco = () => {
      const p = atual.current.palco.current?.getBoundingClientRect();
      const c = canvas.getBoundingClientRect();
      palcoDx = p ? c.left - p.left : 0;
      palcoDy = p ? c.top - p.top : 0;
    };

    const tracar = (ax: number, ay: number, bx: number, by: number) => {
      // chamado com destination-out ativo: borda suave + miolo
      if (Math.abs(bx - ax) + Math.abs(by - ay) < 0.5) {
        ctx.globalAlpha = 0.35;
        ctx.beginPath(); ctx.arc(ax, ay, raio * 1.25, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.arc(ax, ay, raio, 0, Math.PI * 2); ctx.fill();
        return;
      }
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
      ctx.globalAlpha = 0.35; ctx.lineWidth = raio * 2.5; ctx.stroke();
      ctx.globalAlpha = 1; ctx.lineWidth = raio * 2; ctx.stroke();
    };

    const limparCelula = (i: number) => {
      const r = rets[i];
      if (r) ctx.clearRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4);
    };

    const redesenhar = () => {
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, W, H);
      if (completo) return;
      desenharFolha(ctx, rets);
      ctx.globalCompositeOperation = "destination-out";
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      for (let k = 0; k < segs.length; k += 4) tracar(segs[k] * W, segs[k + 1] * H, segs[k + 2] * W, segs[k + 3] * H);
      ctx.globalCompositeOperation = "source-over";
      for (let i = 0; i < 9; i++) if (abertasM[i]) limparCelula(i);
    };

    const medir = () => {
      const b = canvas.getBoundingClientRect();
      if (!b.width || !b.height) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      W = b.width; H = b.height;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      rets = celulas.current.map((el) => {
        const r = el?.getBoundingClientRect();
        return r ? { x: r.left - b.left, y: r.top - b.top, w: r.width, h: r.height } : { x: 0, y: 0, w: 0, h: 0 };
      });
      raio = Math.max(13, Math.min(17, W * 0.048)); // pincel de 26 a 34 px
      caixa = b;
      redesenhar();
    };

    const agendar = () => { if (!raf) raf = requestAnimationFrame(quadro); };

    const pararSom = () => { rasp?.parar(90); rasp = null; };

    const abrir = (i: number) => {
      abertasM[i] = true;
      const red = atual.current.reduzido;
      if (red) limparCelula(i); else fades.push({ i, passos: PASSOS_CELULA });
      som.revelaSimbolo();
      if (!red) {
        offsetPalco();
        const r = rets[i];
        atual.current.particulas.current?.disparar({ x: palcoDx + r.x + r.w / 2, y: palcoDy + r.y + r.h / 2, tipo: "brilho", quantidade: 3, forca: 0.8, espalhar: r.w * 0.4 });
      }
      setAbertas((m) => m | (1 << i));
    };

    const completar = (rapido: boolean) => {
      completo = true; pedidoRevelar = false; sujo = false; arrastando = false;
      pararSom();
      setAbertas(TODAS);
      const dur = atual.current.reduzido ? 0 : rapido ? FADE_REVELAR_MS : FADE_TOTAL_MS;
      canvas.style.pointerEvents = "none";
      canvas.style.transition = dur ? `opacity ${dur}ms ease-out` : "none";
      canvas.style.opacity = "0";
      timers.push(window.setTimeout(() => atual.current.aoCompletar(), dur + 20));
    };

    const verificar = () => {
      if (completo || !atual.current.jogada) return;
      if (pedidoRevelar) { completar(true); return; }
      sujo = false;
      let total = 0, todas = true;
      for (let i = 0; i < 9; i++) {
        if (!abertasM[i] && cont[i] / PONTOS >= LIMIAR_CELULA) abrir(i);
        total += abertasM[i] ? 1 : cont[i] / PONTOS;
        if (!abertasM[i]) todas = false;
      }
      if (todas || total / 9 >= LIMIAR_TOTAL) completar(false);
    };

    function quadro() {
      raf = 0;
      const agora = performance.now();
      if (fila.length) {
        ctx!.globalCompositeOperation = "destination-out";
        ctx!.lineCap = "round"; ctx!.lineJoin = "round";
        for (let k = 0; k < fila.length; k += 4) tracar(fila[k], fila[k + 1], fila[k + 2], fila[k + 3]);
        ctx!.globalCompositeOperation = "source-over";
        fila = [];
      }
      if (fades.length) {
        ctx!.globalCompositeOperation = "destination-out";
        ctx!.globalAlpha = 0.42;
        for (let k = fades.length - 1; k >= 0; k--) {
          const f = fades[k];
          const r = rets[f.i];
          if (--f.passos <= 0) { limparCelula(f.i); fades.splice(k, 1); }
          else ctx!.fillRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4);
        }
        ctx!.globalAlpha = 1;
        ctx!.globalCompositeOperation = "source-over";
      }
      if (rasp && agora - ultMov > 70) rasp.ajustar(0); // dedo parado: silencio
      const temJogada = !!atual.current.jogada;
      if ((sujo || pedidoRevelar) && temJogada && agora - ultimaVerif >= VERIFICAR_MS) { ultimaVerif = agora; verificar(); }
      if (!completo && (arrastando || fades.length || ((sujo || pedidoRevelar) && temJogada))) agendar();
      else if (fades.length) agendar();
    }

    const riscar = (ax: number, ay: number, bx: number, by: number) => {
      if (!W || !H) return;
      fila.push(ax, ay, bx, by);
      segs.push(ax / W, ay / H, bx / W, by / H);
      for (let i = 0; i < 9; i++) if (!abertasM[i] && rets[i]) cont[i] += marcarSegmento(cob[i], rets[i], ax, ay, bx, by, raio);
      sujo = true;
    };

    const tocar = () => {
      if (tocou) return;
      tocou = true;
      atual.current.aoTocar();
    };

    const aoBaixar = (e: PointerEvent) => {
      if (completo || !atual.current.habilitado) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (arrastando) return; // um dedo por vez
      som.destravar();
      tocar();
      arrastando = true;
      idPonteiro = e.pointerId;
      try { canvas.setPointerCapture(e.pointerId); } catch { /* ok */ }
      caixa = canvas.getBoundingClientRect();
      offsetPalco();
      ultX = e.clientX - caixa.left; ultY = e.clientY - caixa.top; ultT = e.timeStamp;
      inicioToque = performance.now();
      riscar(ultX, ultY, ultX, ultY);
      agendar();
    };

    const aoMover = (e: PointerEvent) => {
      if (!arrastando || e.pointerId !== idPonteiro || completo) return;
      const lista = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
      const x0 = ultX, y0 = ultY, t0 = ultT;
      for (const ev of lista.length ? lista : [e]) {
        const x = ev.clientX - caixa.left, y = ev.clientY - caixa.top;
        riscar(ultX, ultY, x, y);
        ultX = x; ultY = y;
      }
      ultT = e.timeStamp;
      const agora = performance.now();
      const vel = Math.min(1, Math.hypot(ultX - x0, ultY - y0) / Math.max(4, ultT - t0) / 1.4);
      ultMov = agora;
      if (!rasp && agora - inicioToque > 40) rasp = som.raspar();
      rasp?.ajustar(vel);
      if (!atual.current.reduzido && vel > 0.08 && agora - ultPart > 50) {
        ultPart = agora;
        atual.current.particulas.current?.disparar({ x: palcoDx + ultX, y: palcoDy + ultY, tipo: "faisca", quantidade: 3, forca: 0.3 + vel * 0.4, cores: RESIDUO });
      }
      if (vel > 0.2 && agora - ultVib > 140) { ultVib = agora; vibrar(5); }
      agendar();
    };

    const aoSoltar = (e: PointerEvent) => {
      if (e.pointerId !== idPonteiro) return;
      arrastando = false;
      idPonteiro = -1;
      pararSom();
      try { canvas.releasePointerCapture(e.pointerId); } catch { /* ok */ }
      agendar();
    };

    api.current = {
      iniciar: () => { if (!completo && atual.current.habilitado) { som.destravar(); tocar(); } },
      revelarTudo: () => {
        if (completo || !atual.current.habilitado) return;
        som.destravar();
        tocar();
        pedidoRevelar = true;
        agendar();
      },
      celebrar: (vencedoras) => {
        const p = atual.current.particulas.current;
        if (!p) return;
        offsetPalco();
        for (const i of vencedoras) {
          const r = rets[i];
          if (r) p.disparar({ x: palcoDx + r.x + r.w / 2, y: palcoDy + r.y + r.h / 2, tipo: "brilho", quantidade: 6, espalhar: r.w * 0.6 });
        }
        if (atual.current.reduzido) return;
        const cx = palcoDx + W / 2, cy = palcoDy + H / 2;
        p.disparar({ x: cx, y: cy, tipo: "ficha", quantidade: 18, forca: 1.1, espalhar: W * 0.3 });
        p.disparar({ x: cx, y: cy, tipo: "confete", quantidade: 46, forca: 1.15, espalhar: W * 0.4 });
        p.disparar({ x: cx, y: cy, tipo: "faisca", quantidade: 30, forca: 1.2 });
      },
      acordar: () => { if (!completo) { sujo = true; agendar(); } },
    };

    medir();
    let rafMedir = 0;
    const obs = new ResizeObserver(() => {
      cancelAnimationFrame(rafMedir);
      rafMedir = requestAnimationFrame(medir);
    });
    obs.observe(grade);
    canvas.addEventListener("pointerdown", aoBaixar);
    canvas.addEventListener("pointermove", aoMover);
    canvas.addEventListener("pointerup", aoSoltar);
    canvas.addEventListener("pointercancel", aoSoltar);
    canvas.addEventListener("lostpointercapture", aoSoltar);

    return () => {
      obs.disconnect();
      cancelAnimationFrame(rafMedir);
      cancelAnimationFrame(raf);
      for (const t of timers) clearTimeout(t);
      pararSom();
      canvas.removeEventListener("pointerdown", aoBaixar);
      canvas.removeEventListener("pointermove", aoMover);
      canvas.removeEventListener("pointerup", aoSoltar);
      canvas.removeEventListener("pointercancel", aoSoltar);
      canvas.removeEventListener("lostpointercapture", aoSoltar);
      api.current = null;
    };
  }, []);

  // jogada chegou com a pelicula ja raspada: confere na hora
  useEffect(() => { if (jogada) api.current?.acordar(); }, [jogada]);

  const res = jogada?.resultado;
  const grade = res?.tipo === "RASPADINHA" ? res.grade : null;
  const vencedoras = res?.tipo === "RASPADINHA" ? res.vencedoras : [];

  return (
    <div
      ref={gradeRef}
      role="group"
      aria-label="Cartela com 9 quadros para raspar"
      className={`${css.grade} ${resultado === "derrota" ? css.derrota : ""} ${resultado === "vitoria" ? css.vitoria : ""}`}
    >
      {Array.from({ length: 9 }, (_, i) => {
        const c = grade?.[i];
        const aberta = (abertas & (1 << i)) !== 0;
        const venceu = resultado === "vitoria" && vencedoras.includes(i);
        const classes = [
          css.celula,
          aberta ? css.aberta : "",
          venceu ? css.vencedora : "",
          resultado === "vitoria" && !venceu ? css.apagada : "",
          c && ISCAS.has(c.icone) ? css.isca : css.premio,
        ].join(" ");
        return (
          <div key={i} ref={(el) => { celulas.current[i] = el; }} className={classes} aria-label={aberta && c ? c.rotulo : "Quadro coberto"}>
            {c && (
              <div className={css.conteudo} style={{ animationDelay: venceu ? `${vencedoras.indexOf(i) * 90}ms` : undefined }}>
                <IconePremio icone={c.icone} tamanho={40} traco={1.5} className={css.icone} />
                <span className={css.rotulo}>{c.rotulo}</span>
              </div>
            )}
          </div>
        );
      })}
      <canvas ref={canvasRef} aria-hidden className={css.pelicula} />
    </div>
  );
});
