"use client";

/**
 * Sons dos jogos, sintetizados na hora (Web Audio): nada para baixar, nada copiado, tudo original da Black.
 * - So liga depois do primeiro toque do usuario (regra do iPhone/Android): `som.destravar()` no clique.
 * - Botao de mudo global (guardado no aparelho).
 * - Cada efeito e curto e leve; os continuos (suspense, vento, raspagem) devolvem um controle para ajustar/parar.
 */

type Raridade = "COMUM" | "RARO" | "EPICO" | "LENDARIO";
export type Continuo = { ajustar: (v: number) => void; parar: (fadeMs?: number) => void };

const CHAVE_MUDO = "bb-jogos-mudo";
const NADA: Continuo = { ajustar: () => {}, parar: () => {} };

class MotorSom {
  private ctx: AudioContext | null = null;
  private mestre: GainNode | null = null;
  private ruidoBuf: AudioBuffer | null = null;
  private ouvintes = new Set<(mudo: boolean) => void>();
  mudo = false;

  constructor() {
    if (typeof window !== "undefined") {
      try { this.mudo = localStorage.getItem(CHAVE_MUDO) === "1"; } catch { /* sem armazenamento */ }
    }
  }

  /** Cria/retoma o audio. Chamar dentro de um clique/toque. */
  destravar() {
    if (typeof window === "undefined") return;
    try {
      if (!this.ctx) {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        const comp = this.ctx.createDynamicsCompressor();
        comp.threshold.value = -14; comp.ratio.value = 4;
        this.mestre = this.ctx.createGain();
        this.mestre.gain.value = this.mudo ? 0 : 0.7;
        this.mestre.connect(comp).connect(this.ctx.destination);
        // 1 s de ruido branco reaproveitado por todos os efeitos.
        const b = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
        const d = b.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        this.ruidoBuf = b;
      }
      if (this.ctx.state === "suspended") void this.ctx.resume();
    } catch { /* navegador sem audio */ }
  }

  alternarMudo() { this.definirMudo(!this.mudo); }
  definirMudo(m: boolean) {
    this.mudo = m;
    try { localStorage.setItem(CHAVE_MUDO, m ? "1" : "0"); } catch { /* ok */ }
    if (this.mestre && this.ctx) this.mestre.gain.setTargetAtTime(m ? 0 : 0.7, this.ctx.currentTime, 0.02);
    for (const f of this.ouvintes) f(m);
  }
  ouvir(f: (mudo: boolean) => void) { this.ouvintes.add(f); return () => { this.ouvintes.delete(f); }; }

  private pronto() { return this.ctx && this.mestre && !this.mudo && this.ctx.state === "running" ? this.ctx : null; }

  /** Tom com envelope rapido (ataque/decaimento). */
  private tom(freq: number, dur: number, o: { tipo?: OscillatorType; vol?: number; ate?: number; atraso?: number; ataque?: number; destino?: AudioNode } = {}) {
    const ctx = this.pronto();
    if (!ctx) return;
    const t = ctx.currentTime + (o.atraso ?? 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = o.tipo ?? "sine";
    osc.frequency.setValueAtTime(freq, t);
    if (o.ate) osc.frequency.exponentialRampToValueAtTime(o.ate, t + dur);
    const vol = o.vol ?? 0.25;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + (o.ataque ?? 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(o.destino ?? this.mestre!);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /** Rajada de ruido filtrado (estalo, whoosh, impacto). */
  private ruido(dur: number, o: { filtro?: BiquadFilterType; freq?: number; ate?: number; q?: number; vol?: number; atraso?: number; ataque?: number } = {}) {
    const ctx = this.pronto();
    if (!ctx || !this.ruidoBuf) return;
    const t = ctx.currentTime + (o.atraso ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.ruidoBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = o.filtro ?? "bandpass";
    f.frequency.setValueAtTime(o.freq ?? 2000, t);
    if (o.ate) f.frequency.exponentialRampToValueAtTime(o.ate, t + dur);
    f.Q.value = o.q ?? 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.vol ?? 0.3, t + (o.ataque ?? 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.mestre!);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  // ---------------- efeitos curtos

  clique() {
    this.tom(1900, 0.05, { tipo: "triangle", vol: 0.18 });
    this.ruido(0.03, { freq: 4500, q: 2, vol: 0.12 });
  }

  selecao() {
    this.tom(880, 0.18, { vol: 0.16 });
    this.tom(1318.5, 0.28, { vol: 0.14, atraso: 0.07 });
  }

  /** Tick do ponteiro passando por uma divisao (forca 0..1: mais fraco quando a roda esta rapida). */
  tick(forca = 1) {
    const v = 0.05 + 0.2 * Math.min(1, Math.max(0, forca));
    this.tom(2300 + Math.random() * 200, 0.035, { tipo: "square", vol: v * 0.5 });
    this.ruido(0.025, { freq: 3800, q: 3, vol: v * 0.6 });
  }

  arranque() {
    this.ruido(0.45, { filtro: "bandpass", freq: 300, ate: 2400, q: 0.8, vol: 0.22, ataque: 0.08 });
    this.tom(140, 0.4, { tipo: "sawtooth", ate: 420, vol: 0.05, ataque: 0.05 });
  }

  /** Batida metalica da tampa/caixa tremendo. */
  tremor(forca = 1) {
    const v = 0.08 + 0.18 * forca;
    for (const f of [523, 1187, 1873]) this.tom(f * (0.98 + Math.random() * 0.04), 0.12, { tipo: "triangle", vol: v * 0.35 });
    this.ruido(0.07, { freq: 2600, q: 4, vol: v });
  }

  abertura() {
    this.ruido(0.5, { filtro: "bandpass", freq: 500, ate: 5000, q: 0.7, vol: 0.28, ataque: 0.06 });
    this.tom(90, 0.35, { ate: 45, vol: 0.4 });
  }

  /** Explosao de luz da revelacao: mais camadas quanto mais raro. */
  explosao(r: Raridade = "COMUM") {
    const nivel = { COMUM: 0, RARO: 1, EPICO: 2, LENDARIO: 3 }[r];
    this.tom(70, 0.6, { ate: 32, vol: 0.5 });
    this.ruido(0.6 + nivel * 0.15, { filtro: "lowpass", freq: 6000, ate: 400, q: 0.5, vol: 0.32 });
    const brilho = [1567.98, 2093, 2637, 3135.96, 4186];
    for (let i = 0; i <= 1 + nivel; i++) this.tom(brilho[i], 0.5 + nivel * 0.15, { vol: 0.07, atraso: 0.04 * i, ataque: 0.01 });
  }

  impacto() {
    this.tom(110, 0.25, { ate: 55, vol: 0.4 });
    for (const f of [880, 1320, 1760]) this.tom(f, 0.6, { tipo: "triangle", vol: 0.06, ataque: 0.002 });
  }

  /** Vitoria curta e original (arpejo maior; lendario ganha acorde final mais longo). */
  vitoria(r: Raridade = "COMUM") {
    const nivel = { COMUM: 0, RARO: 1, EPICO: 2, LENDARIO: 3 }[r];
    const notas = [523.25, 659.25, 783.99, 1046.5];
    notas.forEach((f, i) => {
      this.tom(f, 0.22, { tipo: "triangle", vol: 0.14, atraso: i * 0.09 });
      this.tom(f * 2, 0.18, { vol: 0.04, atraso: i * 0.09 });
    });
    if (nivel >= 1) [1046.5, 1318.5, 1568].forEach((f) => this.tom(f, 0.7 + nivel * 0.25, { tipo: "triangle", vol: 0.07, atraso: 0.38, ataque: 0.02 }));
    if (nivel >= 3) [261.63, 392].forEach((f) => this.tom(f, 1.4, { tipo: "sawtooth", vol: 0.03, atraso: 0.38, ataque: 0.05 }));
  }

  revelaSimbolo() {
    this.tom(1174.66, 0.12, { tipo: "triangle", vol: 0.12 });
  }

  combinacao() {
    [987.77, 1318.5, 1760].forEach((f, i) => this.tom(f, 0.16, { tipo: "square", vol: 0.05, atraso: i * 0.08 }));
  }

  /** Nao foi dessa vez: dois tons baixos e curtos, sem drama. */
  neutro() {
    this.tom(392, 0.22, { tipo: "triangle", vol: 0.1 });
    this.tom(329.63, 0.32, { tipo: "triangle", vol: 0.09, atraso: 0.16 });
  }

  // ---------------- continuos

  /** Ruido + tom subindo enquanto a expectativa cresce. `ajustar(0..1)` aumenta a tensao. */
  suspense(): Continuo {
    const ctx = this.pronto();
    if (!ctx || !this.ruidoBuf) return NADA;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.ruidoBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.Q.value = 6; f.frequency.value = 300;
    const osc = ctx.createOscillator(); osc.type = "sawtooth"; osc.frequency.value = 110;
    const og = ctx.createGain(); og.gain.value = 0.02;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.3);
    src.connect(f).connect(g);
    osc.connect(og).connect(g);
    g.connect(this.mestre!);
    src.start(); osc.start();
    return {
      ajustar: (v) => {
        const n = ctx.currentTime, x = Math.min(1, Math.max(0, v));
        f.frequency.setTargetAtTime(300 + x * 2600, n, 0.08);
        osc.frequency.setTargetAtTime(110 + x * 330, n, 0.08);
        g.gain.setTargetAtTime(0.1 + x * 0.14, n, 0.08);
      },
      parar: (ms = 120) => {
        const n = ctx.currentTime;
        g.gain.setTargetAtTime(0.0001, n, ms / 4000);
        src.stop(n + ms / 1000 + 0.1); osc.stop(n + ms / 1000 + 0.1);
      },
    };
  }

  /** Vento da roda girando: `ajustar(velocidade 0..1)`. */
  vento(): Continuo {
    const ctx = this.pronto();
    if (!ctx || !this.ruidoBuf) return NADA;
    const src = ctx.createBufferSource(); src.buffer = this.ruidoBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.Q.value = 1.2; f.frequency.value = 400;
    const g = ctx.createGain(); g.gain.value = 0.0001;
    src.connect(f).connect(g).connect(this.mestre!);
    src.start();
    return {
      ajustar: (v) => {
        const n = ctx.currentTime, x = Math.min(1, Math.max(0, v));
        f.frequency.setTargetAtTime(250 + x * 1400, n, 0.05);
        g.gain.setTargetAtTime(0.0001 + x * 0.09, n, 0.05);
      },
      parar: (ms = 200) => { const n = ctx.currentTime; g.gain.setTargetAtTime(0.0001, n, ms / 4000); src.stop(n + ms / 1000 + 0.1); },
    };
  }

  /** Raspagem: segue a velocidade do dedo (`ajustar(0..1)`; 0 = parado, silencio). */
  raspar(): Continuo {
    const ctx = this.pronto();
    if (!ctx || !this.ruidoBuf) return NADA;
    const src = ctx.createBufferSource(); src.buffer = this.ruidoBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.Q.value = 0.9; f.frequency.value = 2800;
    const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 900;
    const g = ctx.createGain(); g.gain.value = 0.0001;
    src.connect(hp).connect(f).connect(g).connect(this.mestre!);
    src.start();
    return {
      ajustar: (v) => {
        const n = ctx.currentTime, x = Math.min(1, Math.max(0, v));
        f.frequency.setTargetAtTime(2000 + x * 2500, n, 0.02);
        g.gain.setTargetAtTime(0.0001 + x * 0.16, n, 0.015);
      },
      parar: (ms = 80) => { const n = ctx.currentTime; g.gain.setTargetAtTime(0.0001, n, ms / 4000); src.stop(n + ms / 1000 + 0.1); },
    };
  }
}

/** Um motor de som so para o app inteiro. */
export const som = new MotorSom();

/** Vibracao discreta (Android; iPhone ignora). Some com o mudo. */
export function vibrar(padrao: number | number[]) {
  if (som.mudo || typeof navigator === "undefined" || !("vibrate" in navigator)) return;
  // Sem toque do usuario o navegador bloqueia (e reclama no console).
  if ((navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive === false) return;
  try { navigator.vibrate(padrao); } catch { /* ok */ }
}
