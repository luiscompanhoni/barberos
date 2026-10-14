"use client";

/**
 * Abertura da caixa-surpresa em tela cheia. O servidor ja decidiu os premios: a tela so anima o que recebeu.
 * Roteiro: caixa chega voando -> toque (pede a jogada na hora) -> suspense (flutua, balanca, treme, luz vaza)
 * -> tampa salta com clarao -> cada premio sai como carta branca e "acende" -> resumo -> ModalResultado.
 * Animacoes so com transform/opacity/filter (Web Animations + requestAnimationFrame).
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { ROTULO_RARIDADE, type JogadaCliente, type JogoCliente, type Raridade } from "@/lib/jogos/tipos";
import { som, vibrar, type Continuo } from "../kit/som";
import { OURO, Particulas, type ParticulasRef } from "../kit/Particulas";
import { useMovimentoReduzido } from "../kit/useMovimentoReduzido";
import { useJogada } from "../kit/useJogada";
import { CartaPremio, ModalResultado, raridadeMaxima } from "../kit/ModalResultado";
import { BotaoSom } from "../kit/BotaoSom";
import { CaixaArte } from "./CaixaArte";
import css from "./caixas.module.css";

type Fase = "chegando" | "pronta" | "suspense" | "abrindo" | "revelando" | "resumo" | "final" | "erro";

/** Intensidade por raridade (particulas e quanto tempo a carta fica em destaque). */
const FORCA: Record<Raridade, { faisca: number; brilho: number; fumaca: number; forca: number; confete: number; segura: number }> = {
  COMUM: { faisca: 34, brilho: 10, fumaca: 5, forca: 0.85, confete: 0, segura: 350 },
  RARO: { faisca: 48, brilho: 14, fumaca: 6, forca: 1, confete: 0, segura: 420 },
  EPICO: { faisca: 70, brilho: 22, fumaca: 8, forca: 1.15, confete: 36, segura: 520 },
  LENDARIO: { faisca: 100, brilho: 32, fumaca: 10, forca: 1.4, confete: 90, segura: 650 },
};

const espera = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const doisQuadros = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

type Props = {
  jogo: Pick<JogoCliente, "id" | "nome" | "raridade" | "premiosPorJogada"> & { fichas?: number };
  aoFechar: () => void;
  aoTerminar?: () => void;
  pendente?: JogadaCliente | null;
  jogar?: () => Promise<JogadaCliente>;
  campanha?: boolean;
};

export function AberturaCaixa({ jogo, aoFechar, aoTerminar, pendente = null, jogar, campanha = false }: Props) {
  const reduzido = useMovimentoReduzido();
  const { pedir, retomar, revelar, limpar, erro } = useJogada(jogo.id, { jogar, revelarNoServidor: !campanha });

  const [fase, setFase] = useState<Fase>("chegando");
  const [jogada, setJogada] = useState<JogadaCliente | null>(null);
  const [atual, setAtual] = useState<number | null>(null);
  const [acesa, setAcesa] = useState(false);
  const [reveladas, setReveladas] = useState(0);
  const [restantes, setRestantes] = useState<number | null>(null);
  const [rodada, setRodada] = useState(0);
  const [usadas, setUsadas] = useState(0);

  const palcoRef = useRef<HTMLDivElement>(null);
  const vooRef = useRef<HTMLDivElement>(null);
  const tremorRef = useRef<HTMLDivElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  const destaqueRef = useRef<HTMLDivElement>(null);
  const particulas = useRef<ParticulasRef>(null);
  /** Cada roteiro tem um numero; pular/fechar/jogar de novo trocam o numero e o roteiro antigo para. */
  const exec = useRef(0);
  const emCurso = useRef(false);
  const jogadaRef = useRef<JogadaCliente | null>(null);
  const pendenteRef = useRef<JogadaCliente | null>(pendente);
  const pularRef = useRef(false);
  const reveladoRef = useRef(false);
  const vitoriaRef = useRef(false);
  const suspenseSom = useRef<Continuo | null>(null);

  const vivo = (tk: number) => tk === exec.current;
  const n = jogada?.premios.length ?? jogo.premiosPorJogada;

  /** Ponto (em px do palco) dentro de um elemento: fx/fy de 0 a 1. */
  const ponto = (el: Element | null, fx = 0.5, fy = 0.5) => {
    const p = palcoRef.current?.getBoundingClientRect();
    const r = el?.getBoundingClientRect();
    if (!p || !r) return { x: 0, y: 0 };
    return { x: r.left - p.left + r.width * fx, y: r.top - p.top + r.height * fy };
  };

  const revelarUmaVez = (j: JogadaCliente) => {
    if (reveladoRef.current) return;
    reveladoRef.current = true;
    void revelar(j);
  };
  const tocarVitoria = (j: JogadaCliente) => {
    if (vitoriaRef.current) return;
    vitoriaRef.current = true;
    if (j.premios.length) som.vitoria(raridadeMaxima(j.premios));
    else som.neutro();
  };
  const pararSuspense = () => {
    suspenseSom.current?.parar(100);
    suspenseSom.current = null;
  };
  const zerarCaixa = () => {
    const el = tremorRef.current;
    if (!el) return;
    el.style.transform = "";
    el.style.setProperty("--luz", "0");
    el.style.setProperty("--aberta", "0");
    el.querySelector("[data-tampa]")?.getAnimations().forEach((a) => a.cancel());
  };

  /** Suspense: roda ate o tempo minimo E a resposta do servidor (estende enquanto espera). */
  const suspense = (tk: number, promessa: Promise<JogadaCliente | null>, dur: number) =>
    new Promise<JogadaCliente | null>((resolve) => {
      const el = tremorRef.current;
      let resultado: JogadaCliente | null | undefined;
      promessa.then((r) => { resultado = r; }, () => { resultado = null; });
      const ctrl = som.suspense();
      suspenseSom.current = ctrl;
      const t0 = performance.now();
      let ultimo = t0, angulo = 0, pico = 0;
      const passo = (agora: number) => {
        if (!vivo(tk)) { ctrl.parar(80); resolve(null); return; }
        const t = agora - t0;
        const dt = Math.min(50, agora - ultimo);
        ultimo = agora;
        if (resultado === null || (resultado && (t >= dur || pularRef.current))) {
          ctrl.parar(resultado ? 60 : 200);
          suspenseSom.current = null;
          if (!resultado && el) { el.style.transform = ""; el.style.setProperty("--luz", "0"); }
          resolve(resultado ?? null);
          return;
        }
        // passou do tempo e o servidor ainda nao respondeu: segura no maximo, pulsando
        const p = t < dur ? t / dur : 0.94 + 0.06 * Math.sin((t - dur) / 150);
        ctrl.ajustar(p);
        if (el) {
          if (!reduzido) {
            const flutua = Math.sin(t / 420) * 6 * (1 - Math.min(1, p / 0.35));
            const balanco = p > 0.15 ? Math.sin(t / 260) * 5 * Math.min(1, (p - 0.15) / 0.3) * (1 - Math.max(0, p - 0.6)) : 0;
            const k = Math.max(0, (p - 0.4) / 0.6); // forca do tremor 0..1
            angulo += (dt / 1000) * (7 + 15 * k) * Math.PI * 2;
            const amp = 0.4 + 6.5 * k * k;
            const x = Math.sin(angulo) * amp;
            const giro = balanco + Math.sin(angulo * 1.37) * amp * 0.45;
            const y = flutua - k * 4 - Math.abs(Math.sin(angulo)) * amp * 0.3;
            el.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) rotate(${giro.toFixed(2)}deg) scale(${(1 + 0.04 * Math.min(1, p)).toFixed(3)})`;
            if (k > 0 && agora - pico > 420 - 300 * k) {
              pico = agora;
              som.tremor(0.25 + 0.75 * k);
              if (k > 0.45) vibrar(8);
            }
          }
          el.style.setProperty("--luz", Math.pow(Math.min(1, p), 1.6).toFixed(3));
        }
        requestAnimationFrame(passo);
      };
      requestAnimationFrame(passo);
    });

  /** Tampa salta + clarao + explosao de luz e particulas. */
  const abrirTampa = async (tk: number, j: JogadaCliente) => {
    const el = tremorRef.current;
    if (!el) return;
    const tampa = el.querySelector<HTMLElement>("[data-tampa]");
    const max = j.premios.length ? raridadeMaxima(j.premios) : "COMUM";
    const f = FORCA[max];
    setFase("abrindo");
    el.style.transform = "";
    som.abertura();
    if (reduzido) {
      tampa?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, fill: "forwards" });
      el.style.setProperty("--aberta", "1");
      el.style.setProperty("--luz", "0.6");
      som.explosao(max);
      vibrar([0, 30, 40, 30]);
      particulas.current?.disparar({ ...ponto(el, 0.5, 0.3), tipo: "brilho", quantidade: f.brilho });
      await espera(200);
      return;
    }
    el.animate(
      [{ transform: "scale(1.07, 0.93)" }, { transform: "scale(0.97, 1.04)", offset: 0.5 }, { transform: "none" }],
      { duration: 320, easing: "ease-out" },
    );
    tampa?.animate(
      [
        { transform: "translate3d(0, 0, 0) rotate(0deg)", opacity: 1 },
        { transform: "translate3d(-6%, -38%, 0) rotate(-14deg)", opacity: 1, offset: 0.46 },
        { transform: "translate3d(-18%, -85%, 0) rotate(-30deg)", opacity: 0 },
      ],
      { duration: 650, easing: "cubic-bezier(.15,.85,.3,1)", fill: "forwards" },
    );
    flashRef.current?.animate(
      [
        { opacity: 0, transform: "translate(-50%, -50%) scale(0.3)" },
        { opacity: 1, transform: "translate(-50%, -50%) scale(1)", offset: 0.3 },
        { opacity: 0, transform: "translate(-50%, -50%) scale(1.7)" },
      ],
      { duration: max === "LENDARIO" ? 720 : 420, easing: "ease-out" },
    );
    await espera(120);
    if (!vivo(tk)) return;
    el.style.setProperty("--aberta", "1");
    el.style.setProperty("--luz", "1");
    som.explosao(max);
    vibrar([0, 30, 40, 30]);
    const m = ponto(el, 0.5, 0.3);
    const pc = particulas.current;
    pc?.disparar({ ...m, tipo: "faisca", quantidade: f.faisca, forca: f.forca, espalhar: 40 });
    pc?.disparar({ ...m, tipo: "brilho", quantidade: f.brilho, forca: f.forca, espalhar: 140 });
    pc?.disparar({ ...m, tipo: "fumaca", quantidade: f.fumaca, espalhar: 70 });
    if (f.confete) pc?.disparar({ ...m, tipo: "confete", quantidade: f.confete, forca: f.forca, cores: OURO });
    await espera(max === "LENDARIO" ? 560 : 380);
    el.style.setProperty("--luz", "0.7");
  };

  /** Cada premio: sai da caixa como carta branca (~280 ms), acende (~500 ms), segura e vai para a fileira. */
  const revelarPremios = async (tk: number, j: JogadaCliente) => {
    setFase("revelando");
    const ps = j.premios;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      const f = FORCA[p.raridade];
      setRestantes(ps.length - i - 1);
      setAcesa(false);
      setAtual(i);
      await doisQuadros();
      for (let k = 0; k < 4 && !destaqueRef.current; k++) await doisQuadros();
      if (!vivo(tk)) return;
      const carta = destaqueRef.current;
      const caixa = tremorRef.current;
      const boca = ponto(caixa, 0.5, 0.3);
      if (carta) {
        const c = ponto(carta);
        carta.animate(
          [
            { transform: `translate3d(${boca.x - c.x}px, ${boca.y - c.y}px, 0) scale(0.2)`, opacity: 0, filter: "blur(4px)" },
            { opacity: 1, offset: 0.3 },
            { transform: "translate3d(0, 0, 0) scale(1.06)", filter: "blur(0px)", offset: 0.8 },
            { transform: "translate3d(0, 0, 0) scale(1)", opacity: 1, filter: "blur(0px)" },
          ],
          { duration: 280, easing: "cubic-bezier(.2,.8,.3,1)", fill: "both" },
        );
      }
      som.arranque();
      particulas.current?.disparar({ ...boca, tipo: "brilho", quantidade: 6, espalhar: 50 });
      await espera(280);
      if (!vivo(tk)) return;

      setAcesa(true);
      if (p.raridade === "LENDARIO") { som.explosao("LENDARIO"); vibrar([0, 40, 30, 40]); }
      else if (p.raridade === "EPICO") { som.impacto(); vibrar(25); }
      else if (p.raridade === "RARO") { som.combinacao(); vibrar(14); }
      else { som.revelaSimbolo(); vibrar(10); }
      const c = ponto(carta);
      const pc = particulas.current;
      pc?.disparar({ ...c, tipo: "brilho", quantidade: Math.round(f.brilho * 0.7), espalhar: 200 });
      pc?.disparar({ ...c, tipo: "faisca", quantidade: Math.round(f.faisca * 0.5), forca: f.forca * 0.8, espalhar: 120 });
      if (f.confete) pc?.disparar({ ...c, tipo: "confete", quantidade: Math.round(f.confete * 0.6), forca: f.forca, cores: OURO });
      await espera(500 + f.segura);
      if (!vivo(tk)) return;

      carta?.animate(
        [{ transform: "none", opacity: 1 }, { transform: "translate3d(0, -70px, 0) scale(0.5)", opacity: 0 }],
        { duration: 200, easing: "ease-in", fill: "forwards" },
      );
      await espera(200);
      if (!vivo(tk)) return;
      setReveladas(i + 1);
    }
  };

  const mostrarResumo = async (tk: number, j: JogadaCliente) => {
    setAtual(null);
    setReveladas(j.premios.length);
    setRestantes(null);
    setFase("resumo");
    revelarUmaVez(j);
    tocarVitoria(j);
    const max = raridadeMaxima(j.premios);
    const w = palcoRef.current?.clientWidth ?? 360;
    if (!reduzido && j.premios.length && (max === "EPICO" || max === "LENDARIO")) {
      particulas.current?.disparar({ x: w / 2, y: 90, tipo: "confete", quantidade: max === "LENDARIO" ? 110 : 60, cores: max === "LENDARIO" ? OURO : undefined, espalhar: w * 0.8 });
    }
    await espera(reduzido ? 700 : 1500);
    if (!vivo(tk)) return;
    setFase("final");
  };

  /** Pula direto para o resultado (a jogada ja esta decidida; so corta a animacao). */
  const finalizar = (j: JogadaCliente) => {
    exec.current++;
    pararSuspense();
    const el = tremorRef.current;
    if (el) el.style.transform = "";
    setAtual(null);
    setReveladas(j.premios.length);
    setRestantes(null);
    revelarUmaVez(j);
    tocarVitoria(j);
    setFase("final");
  };

  const abrir = async () => {
    if (emCurso.current) return;
    emCurso.current = true;
    som.destravar();
    som.clique();
    vibrar(10);
    const tk = ++exec.current;
    pularRef.current = false;
    const guardada = pendenteRef.current;
    pendenteRef.current = null;
    if (guardada) retomar(guardada);
    // a requisicao sai agora, enquanto o suspense roda
    const promessa = guardada ? Promise.resolve(guardada) : pedir();
    setFase("suspense");
    const j = await suspense(tk, promessa, reduzido ? 350 : guardada ? 1500 : 2000);
    if (!vivo(tk)) return;
    if (!j) {
      emCurso.current = false;
      zerarCaixa();
      setFase("erro");
      return;
    }
    if (!guardada) setUsadas((u) => u + 1);
    jogadaRef.current = j;
    setJogada(j);
    if (pularRef.current) { finalizar(j); return; }
    setRestantes(j.premios.length);
    await abrirTampa(tk, j);
    if (!vivo(tk)) return;
    if (!reduzido && j.premios.length) {
      await revelarPremios(tk, j);
      if (!vivo(tk)) return;
    }
    await mostrarResumo(tk, j);
  };

  const pular = () => {
    som.clique();
    const j = jogadaRef.current;
    if (j) finalizar(j);
    else pularRef.current = true; // corta assim que o servidor responder
  };

  const fechar = () => {
    exec.current++;
    pararSuspense();
    const j = jogadaRef.current;
    if (j && (fase === "revelando" || fase === "resumo" || fase === "final")) revelarUmaVez(j);
    aoTerminar?.();
    aoFechar();
  };

  const jogarDeNovo = () => {
    som.destravar();
    som.clique();
    vibrar(10);
    const j = jogadaRef.current;
    if (j) revelarUmaVez(j);
    aoTerminar?.();
    exec.current++;
    limpar();
    jogadaRef.current = null;
    reveladoRef.current = false;
    vitoriaRef.current = false;
    pularRef.current = false;
    emCurso.current = false;
    zerarCaixa();
    particulas.current?.limpar();
    setJogada(null);
    setAtual(null);
    setAcesa(false);
    setReveladas(0);
    setRestantes(null);
    setFase("chegando");
    setRodada((r) => r + 1);
  };

  // versoes atuais para os ouvintes registrados uma vez so
  const aoChegar = useRef<() => void>(() => {});
  const fecharRef = useRef<() => void>(() => {});
  useEffect(() => {
    aoChegar.current = () => {
      if (pendenteRef.current) void abrir(); // premio guardado: abre direto
      else setFase("pronta");
    };
    fecharRef.current = fechar;
  });

  // chegada: a caixa voa ate o centro e assenta com um quique
  useLayoutEffect(() => {
    const voo = vooRef.current;
    if (!voo) return;
    som.selecao();
    const anim = reduzido
      ? voo.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: "ease-out" })
      : voo.animate(
          [
            { transform: "translate3d(0, 55vh, 0) scale(0.35)", opacity: 0, filter: "blur(8px)" },
            { opacity: 1, offset: 0.35 },
            { transform: "translate3d(0, -14px, 0) scale(1.04, 0.97)", filter: "blur(0px)", offset: 0.72 },
            { transform: "translate3d(0, 4px, 0) scale(0.98, 1.03)", offset: 0.86 },
            { transform: "none", opacity: 1, filter: "blur(0px)" },
          ],
          { duration: 480, easing: "cubic-bezier(.22,.9,.32,1)" },
        );
    let ativo = true;
    anim.finished.then(() => { if (ativo) aoChegar.current(); }, () => {});
    return () => { ativo = false; anim.cancel(); };
  }, [rodada, reduzido]);

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") fecharRef.current(); };
    window.addEventListener("keydown", tecla);
    const ex = exec, ss = suspenseSom;
    return () => {
      window.removeEventListener("keydown", tecla);
      ex.current++;
      ss.current?.parar(60);
    };
  }, []);

  const podePular = fase === "suspense" || fase === "abrindo" || fase === "revelando" || fase === "resumo";
  const fichasRestantes = Math.max(0, (jogo.fichas ?? 0) - usadas);
  const premioAtual = atual !== null ? jogada?.premios[atual] : undefined;
  const fimVisivel = fase === "resumo" || fase === "final";

  return (
    <div ref={palcoRef} className={`${css.palco} jogo-fumaca`} role="dialog" aria-modal="true" aria-label={`Abrir ${jogo.nome}`}>
      <header className="relative z-30 flex items-start justify-between gap-3 px-4 pb-2" style={{ paddingTop: "max(14px, env(safe-area-inset-top))" }}>
        <div className="min-w-0">
          <p className="jogo-subtitulo">{ROTULO_RARIDADE[jogo.raridade]} · {n} {n === 1 ? "prêmio garantido" : "prêmios garantidos"}</p>
          <h2 className="jogo-titulo mt-1 truncate text-2xl">{jogo.nome}</h2>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {podePular && <button type="button" onClick={pular} className="jogo-botao-texto px-2">Pular</button>}
          <BotaoSom />
          <button type="button" onClick={fechar} aria-label="Fechar" className="jogo-botao-redondo"><X size={18} /></button>
        </div>
      </header>

      {/* premios ja revelados */}
      <div className={css.linha} style={{ height: fase === "revelando" && n > 1 ? 110 : 0 }}>
        {fase === "revelando" && jogada?.premios.slice(0, reveladas).map((p) => (
          <div key={p.id} className={css.mini}><CartaPremio p={p} className="jogo-surgir" /></div>
        ))}
      </div>

      <div className={css.centro}>
        {fase === "revelando" && premioAtual && (
          <div key={atual} ref={destaqueRef} data-raridade={premioAtual.raridade} className={`${css.destaque} ${acesa ? css.acesa : ""}`} style={{ opacity: 0 }}>
            <div className={css.halo} />
            <CartaPremio p={premioAtual} grande className={css.cartaReal} />
            <div className={css.cartaBranca} />
          </div>
        )}

        {fimVisivel && jogada && (
          <div className={css.resumo}>
            <p className="jogo-subtitulo">{jogada.premios.length ? "Você recebeu:" : "Não foi dessa vez"}</p>
            <div className="flex flex-wrap justify-center gap-2">
              {jogada.premios.map((p, i) => (
                <CartaPremio key={p.id} p={p} grande={jogada.premios.length === 1} className="jogo-surgir" style={{ animationDelay: `${i * 110}ms` }} />
              ))}
            </div>
          </div>
        )}

        <div ref={vooRef} className={`${css.voo} ${fimVisivel ? css.sumir : ""}`}>
          <div className={fase === "pronta" && !reduzido ? css.flutuar : ""}>
            <div ref={tremorRef} className={css.tremor}>
              <button type="button" onClick={() => void abrir()} disabled={fase !== "pronta"} className={css.alvo} aria-label={`Abrir ${jogo.nome}`}>
                <CaixaArte raridade={jogo.raridade} />
              </button>
              <div ref={flashRef} className={css.flash} aria-hidden />
              {restantes !== null && restantes > 0 && (
                <span key={restantes} className={`${css.contador} ${css.contadorPulo}`} aria-label={`${restantes} restantes`}>{restantes}</span>
              )}
            </div>
          </div>
        </div>
      </div>

      <footer className="relative z-30 grid min-h-[104px] place-items-center gap-2 px-4 pt-2 text-center" style={{ paddingBottom: "max(16px, env(safe-area-inset-bottom))" }} aria-live="polite">
        {fase === "pronta" && (
          <>
            <p className="text-xs font-semibold tracking-wide text-[#a39d95]">Toque na caixa para abrir</p>
            <button type="button" onClick={() => void abrir()} className="jogo-botao-ouro w-full max-w-xs">Abrir</button>
          </>
        )}
        {(fase === "suspense" || fase === "abrindo") && <p className="jogo-subtitulo">Abrindo…</p>}
        {fase === "revelando" && atual !== null && <p className="jogo-subtitulo">Prêmio {atual + 1} de {n}</p>}
        {fase === "resumo" && (
          <button type="button" onClick={() => { exec.current++; setFase("final"); }} className="jogo-botao-grafite w-full max-w-xs">Continuar</button>
        )}
        {fase === "erro" && (
          <>
            <p className="max-w-sm text-sm text-[#f1e3b8]" role="alert">{erro || "Não foi possível abrir agora. Tente de novo."}</p>
            <div className="flex w-full max-w-xs flex-col gap-2">
              <button type="button" onClick={() => void abrir()} className="jogo-botao-ouro">Tentar de novo</button>
              <button type="button" onClick={fechar} className="jogo-botao-texto">Fechar</button>
            </div>
          </>
        )}
      </footer>

      <Particulas ref={particulas} className="z-20" />

      {fase === "final" && jogada && (
        <ModalResultado
          jogada={jogada}
          aoFechar={fechar}
          campanha={campanha}
          jogarDeNovo={fichasRestantes > 0 ? jogarDeNovo : undefined}
          fichasRestantes={fichasRestantes}
        />
      )}
    </div>
  );
}
