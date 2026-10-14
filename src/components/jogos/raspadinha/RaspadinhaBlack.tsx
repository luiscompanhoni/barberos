"use client";

/**
 * Raspadinha Black: raspe a cartela 3x3 e combine 3 simbolos iguais.
 * O servidor decide e grava tudo no primeiro toque; a tela so revela a grade que ele mandou.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { reais } from "@/lib/cliente-api";
import type { JogadaCliente, JogoCliente } from "@/lib/jogos/tipos";
import { BotaoSom } from "../kit/BotaoSom";
import { IconePremio } from "../kit/IconePremio";
import { ModalResultado, raridadeMaxima } from "../kit/ModalResultado";
import { Particulas, type ParticulasRef } from "../kit/Particulas";
import { som, vibrar } from "../kit/som";
import { useJogada } from "../kit/useJogada";
import { useMovimentoReduzido } from "../kit/useMovimentoReduzido";
import { CartaRaspavel, type CartaRaspavelRef } from "./CartaRaspavel";
import css from "./raspadinha.module.css";

type Fase = "pronto" | "raspando" | "revelado" | "fim";
const ORDEM = { COMUM: 0, RARO: 1, EPICO: 2, LENDARIO: 3 } as const;

export function RaspadinhaBlack({ jogo, jogar, campanha = false, aoTerminar }: {
  jogo: Pick<JogoCliente, "id" | "nome" | "fichas" | "vitrine" | "comoGanhar" | "pendente">;
  jogar?: () => Promise<JogadaCliente>;
  campanha?: boolean;
  aoTerminar?: () => void;
}) {
  const reduzido = useMovimentoReduzido();
  const opcoes = useMemo(() => ({ jogar, revelarNoServidor: !campanha }), [jogar, campanha]);
  const { jogada, pedindo, erro, pedir, retomar, revelar, limpar } = useJogada(jogo.id, opcoes);

  const palco = useRef<HTMLElement>(null);
  const particulas = useRef<ParticulasRef>(null);
  const carta = useRef<CartaRaspavelRef>(null);
  const timers = useRef<number[]>([]);

  const [fase, setFase] = useState<Fase>("pronto");
  const [rodada, setRodada] = useState(0);
  const [modal, setModal] = useState(false);
  const [usouPendente, setUsouPendente] = useState(false);
  // fichas gastas aqui enquanto o pai ainda nao atualizou `jogo.fichas`
  const [ajuste, setAjuste] = useState({ base: -1, gastas: 0 });

  useEffect(() => () => { for (const t of timers.current) clearTimeout(t); }, []);
  const depois = (ms: number, f: () => void) => { timers.current.push(window.setTimeout(f, ms)); };

  const fichas = jogo.fichas === ajuste.base ? Math.max(0, jogo.fichas - ajuste.gastas) : jogo.fichas;
  const pendenteAtiva = !!jogo.pendente && !usouPendente;
  const podeJogar = fichas > 0 || pendenteAtiva;
  const resultado = jogada && (fase === "revelado" || fase === "fim") ? (jogada.vitoria ? "vitoria" : "derrota") : null;
  const premio = jogada?.premios[0];

  const melhores = useMemo(
    () => [...jogo.vitrine].filter((p) => p.tipo !== "NADA").sort((a, b) => ORDEM[b.raridade] - ORDEM[a.raridade] || a.chanceBps - b.chanceBps).slice(0, 4),
    [jogo.vitrine],
  );

  /** Primeiro toque (ou "Raspar"): o servidor decide e grava antes de qualquer revelacao. */
  const iniciar = async () => {
    if (fase !== "pronto" || !podeJogar) return;
    setFase("raspando");
    if (pendenteAtiva && jogo.pendente) {
      setUsouPendente(true);
      retomar(jogo.pendente);
      return;
    }
    const base = jogo.fichas;
    const j = await pedir();
    if (!j) {
      // erro: volta a cartela coberta, sem gastar nada
      setFase("pronto");
      setRodada((r) => r + 1);
      return;
    }
    setAjuste((a) => (a.base === base ? { base, gastas: a.gastas + 1 } : { base, gastas: 1 }));
  };

  const aoCompletar = () => {
    const j = jogada;
    if (!j) return;
    setFase("revelado");
    void revelar(j);
    if (j.vitoria) {
      const venc = j.resultado.tipo === "RASPADINHA" ? j.resultado.vencedoras : [];
      som.combinacao();
      vibrar(12);
      depois(reduzido ? 150 : 420, () => {
        som.vitoria(raridadeMaxima(j.premios));
        vibrar([25, 40, 25]);
        carta.current?.celebrar(venc);
      });
      depois(reduzido ? 900 : 2000, () => setModal(true));
    } else {
      som.neutro();
      depois(reduzido ? 700 : 1400, () => setModal(true));
    }
  };

  const fechar = () => {
    setModal(false);
    setFase("fim");
    aoTerminar?.();
  };

  const deNovo = () => {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
    som.clique();
    limpar();
    setModal(false);
    setFase("pronto");
    setRodada((r) => r + 1);
    aoTerminar?.();
  };

  const botaoRaspar = () => {
    som.destravar();
    som.clique();
    carta.current?.iniciar();
  };

  let faixa: React.ReactNode;
  if (resultado === "vitoria") {
    faixa = (
      <div className={css.ganhou}>
        <p className="jogo-titulo text-3xl">Você ganhou!</p>
        {premio && (
          <p className={`${css.premioChip} mt-1`}>
            <IconePremio icone={premio.icone} tamanho={20} />
            {premio.tipo === "CREDITO" ? `${reais(premio.valorCentavos)} de crédito` : premio.rotulo}
          </p>
        )}
      </div>
    );
  } else if (resultado === "derrota") {
    faixa = <p className="text-lg font-black uppercase tracking-wide text-[#d9ccb0]">Não foi dessa vez</p>;
  } else if (fase === "raspando") {
    faixa = <p className={css.dica}>{jogada ? "Encontre 3 símbolos iguais" : "Preparando sua raspadinha…"}</p>;
  } else {
    faixa = <p className={css.dica}>Toque e raspe os 9 quadros</p>;
  }

  return (
    <>
      <section ref={palco} className="jogo-palco jogo-fumaca text-white">
        <div className="relative z-10 grid gap-6 p-4 pt-14 sm:p-6 sm:pt-14 md:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] md:items-center md:gap-8 md:pt-6">
          <div className="mx-auto w-full max-w-[420px]">
            <div className={`${css.cartao} ${resultado === "vitoria" ? css.cartaoVitoria : ""} ${resultado === "derrota" ? css.cartaoDerrota : ""}`}>
              <div className={css.cabeca} aria-hidden>
                <span><b>BB</b> Raspadinha Black</span>
                <span>Nº {jogada ? jogada.id.slice(-6).toUpperCase() : "······"}</span>
              </div>
              <CartaRaspavel
                key={rodada}
                ref={carta}
                jogada={jogada}
                habilitado={podeJogar || fase !== "pronto"}
                reduzido={reduzido}
                resultado={resultado}
                aoTocar={() => { void iniciar(); }}
                aoCompletar={aoCompletar}
                particulas={particulas}
                palco={palco}
              />
              <div className={css.faixa} aria-live="polite">{faixa}</div>
              {!podeJogar && fase === "pronto" && (
                <div className={css.bloqueio}>
                  <div className="px-6">
                    <p className="jogo-titulo text-xl">Sem raspadinhas</p>
                    <p className="mt-2 text-xs text-zinc-400">Veja ao lado como conseguir mais.</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="mx-auto w-full max-w-[420px] md:mx-0">
            <p className="jogo-subtitulo">{jogo.nome}</p>
            <h2 className="jogo-titulo mt-2 text-4xl sm:text-5xl">Raspe e Ganhe</h2>
            <p className="mt-2 text-sm font-semibold text-zinc-400">Raspe e combine 3 iguais</p>

            {melhores.length > 0 && (
              <div className="mt-5">
                <p className="jogo-subtitulo text-[10px]">Melhores prêmios</p>
                <ul className={`${css.vitrine} mt-2`}>
                  {melhores.map((p) => (
                    <li key={p.id} className={css.vitrineItem}>
                      <IconePremio icone={p.icone} tamanho={26} traco={1.5} />
                      <span>{p.rotulo}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-5 flex flex-wrap items-center gap-2">
              <span className="jogo-contador">Raspadinhas: <b>{fichas}</b></span>
              {pendenteAtiva && fase === "pronto" && <span className="jogo-selo">Raspadinha em andamento</span>}
            </div>

            {erro && <p role="alert" className="mt-3 text-sm font-semibold text-red-300">{erro}</p>}

            <div className="mt-4 grid gap-2 sm:max-w-xs">
              {fase === "pronto" && podeJogar && (
                <button type="button" onClick={botaoRaspar} disabled={pedindo} className="jogo-botao-ouro">
                  {pendenteAtiva ? "Continuar raspando" : "Raspar"}
                </button>
              )}
              {((fase === "pronto" && podeJogar) || fase === "raspando") && (
                <button type="button" onClick={() => carta.current?.revelarTudo()} className="jogo-botao-texto">Revelar tudo</button>
              )}
              {fase === "fim" && fichas > 0 && (
                <button type="button" onClick={deNovo} className="jogo-botao-ouro">Nova raspadinha</button>
              )}
              {fase === "fim" && jogada && (
                <button type="button" onClick={() => setModal(true)} className="jogo-botao-grafite">Ver resultado</button>
              )}
            </div>

            {fichas === 0 && !pendenteAtiva && fase !== "raspando" && jogo.comoGanhar.length > 0 && (
              <div className="mt-5">
                <p className="jogo-subtitulo text-[10px]">Conseguir mais</p>
                <ul className="mt-2 grid gap-1.5 text-sm text-zinc-300">
                  {jogo.comoGanhar.map((t) => (
                    <li key={t} className="flex items-start gap-2"><span className="mt-2 h-1 w-1 shrink-0 rotate-45 bg-[#e9c46a]" />{t}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
        <Particulas ref={particulas} className="z-20" />
        <BotaoSom className="absolute right-3 top-3 z-30" />
      </section>

      {modal && jogada && (
        <ModalResultado
          jogada={jogada}
          campanha={campanha}
          aoFechar={fechar}
          jogarDeNovo={fichas > 0 ? deNovo : undefined}
          fichasRestantes={fichas}
        />
      )}
    </>
  );
}
