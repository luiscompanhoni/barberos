"use client";

/**
 * Roleta Black (Gire e Ganhe). Toque em GIRAR -> o botao trava -> o servidor sorteia e grava -> a roda arranca,
 * mantem, desacelera e para na fatia do premio. Ticks e vibracao acompanham cada divisao; na vitoria: clarao,
 * destaque da fatia, particulas e o "Você ganhou". Jogada pendente (pagina atualizada no meio) gira de novo ate o
 * mesmo premio, sem gastar outra jogada.
 */
import { useRef, useState } from "react";
import type { FatiaRoleta, JogadaCliente, JogoCliente } from "@/lib/jogos/tipos";
import { BotaoSom } from "../kit/BotaoSom";
import { ModalResultado, raridadeMaxima } from "../kit/ModalResultado";
import { Particulas, type ParticulasRef } from "../kit/Particulas";
import { som, vibrar, type Continuo } from "../kit/som";
import { useJogada, type Jogar } from "../kit/useJogada";
import { useMovimentoReduzido } from "../kit/useMovimentoReduzido";
import { RodaBlack, type RodaRef } from "./RodaBlack";

type JogoRoleta = Pick<JogoCliente, "id" | "nome" | "fichas" | "fatias" | "comoGanhar" | "pendente" | "proximaGratisEm"> & { multiplicador?: number; assinante?: boolean };

export function RoletaBlack({ jogo, jogar, campanha = false, aoTerminar }: { jogo: JogoRoleta; jogar?: Jogar; campanha?: boolean; aoTerminar?: () => void }) {
  const { pedir, revelar, erro, retomar } = useJogada(jogo.id, { jogar, revelarNoServidor: !campanha });
  const roda = useRef<RodaRef>(null);
  const particulas = useRef<ParticulasRef>(null);
  const palco = useRef<HTMLDivElement>(null);
  const reduzido = useMovimentoReduzido();
  const [fatias, setFatias] = useState<FatiaRoleta[]>(jogo.fatias);
  const [fichas, setFichas] = useState(jogo.fichas);
  const [girando, setGirando] = useState(false);
  const [vencedora, setVencedora] = useState<number | null>(null);
  const [clarao, setClarao] = useState(false);
  const [resultado, setResultado] = useState<JogadaCliente | null>(null);
  // Jogada ja decidida mas nao revelada (pagina atualizada no meio): o proximo GIRAR so anima ate ela.
  const [pendente, setPendente] = useState<JogadaCliente | null>(jogo.pendente);

  async function girar() {
    if (girando) return;
    som.destravar();
    som.clique();
    vibrar(12);
    setVencedora(null);
    setGirando(true);
    // Retomada: a jogada ja existe no servidor; so anima de novo.
    const retomada = !!pendente;
    let j = pendente;
    if (j) retomar(j);
    else j = await pedir();
    setPendente(null);
    if (!j || j.resultado.tipo !== "ROLETA") { setGirando(false); return; }
    // A jogada pendente ja tinha gasto o giro (o contador do servidor ja descontou).
    if (!retomada) setFichas((f) => Math.max(0, f - 1));
    const { fatias: snap, indice } = j.resultado;
    setFatias(snap);
    await animar(j, indice);
  }

  async function animar(j: JogadaCliente, indice: number) {
    som.arranque();
    let vento: Continuo | null = som.vento();
    await roda.current?.girarAte(indice, {
      reduzido,
      aoVelocidade: (v) => vento?.ajustar(v),
      aoPassar: (v) => {
        // Rapido: tick baixinho; devagar: tick forte e uma vibracao curta (passando lentamente pelas ultimas).
        som.tick(1 - v * 0.75);
        if (v < 0.25) vibrar(6);
      },
    });
    vento?.parar(150);
    vento = null;
    setGirando(false);
    setVencedora(indice);
    const r = palco.current?.getBoundingClientRect();
    const cx = (r?.width ?? 300) / 2, cy = (r?.height ?? 300) / 2;
    if (j.vitoria) {
      const rar = raridadeMaxima(j.premios);
      som.impacto();
      vibrar([0, 35, 40, 35]);
      setClarao(true);
      setTimeout(() => setClarao(false), 800);
      setTimeout(() => {
        som.vitoria(rar);
        particulas.current?.disparar({ x: cx, y: cy * 0.55, tipo: "faisca", quantidade: rar === "LENDARIO" ? 80 : 50, forca: 1.2 });
        particulas.current?.disparar({ x: cx, y: cy * 0.6, tipo: "brilho", quantidade: 18, espalhar: cx });
        particulas.current?.disparar({ x: cx, y: cy * 0.4, tipo: rar === "COMUM" ? "ficha" : "confete", quantidade: rar === "LENDARIO" ? 110 : 60 });
      }, 120);
    } else {
      som.neutro();
    }
    setTimeout(() => { setResultado(j); void revelar(j); }, j.vitoria ? 1300 : 900);
  }

  function fechar() {
    setResultado(null);
    setVencedora(null);
    roda.current?.parado();
    aoTerminar?.();
  }

  const podeGirar = (fichas > 0 || !!pendente) && !girando && !resultado && fatias.length >= 2;

  return (
    <div className="mx-auto w-full max-w-[480px]">
      <div ref={palco} className="jogo-palco jogo-fumaca px-4 pb-5 pt-4 sm:px-6">
        <div className="relative z-10 flex items-start justify-between">
          <div>
            <p className="jogo-subtitulo">Spin &amp; Win</p>
            <h1 className="jogo-titulo text-[30px] sm:text-[36px]">{jogo.nome}</h1>
          </div>
          <div className="flex items-center gap-2">
            {!!jogo.multiplicador && jogo.multiplicador > 100 && <span className="jogo-selo" title="Bônus de assinante nos prêmios em dinheiro">VIP x{(jogo.multiplicador / 100).toFixed(1)}</span>}
            <BotaoSom />
          </div>
        </div>

        <div className="relative z-10 mt-4">
          <RodaBlack ref={roda} fatias={fatias} girando={girando} vencedora={vencedora} podeGirar={podeGirar} aoGirar={girar}
          />
          {clarao && <div className="rb-clarao" aria-hidden />}
        </div>

        <div className="relative z-10 mt-5 flex items-center justify-between gap-3">
          <span className="jogo-contador"><b>{fichas}</b> {fichas === 1 ? "giro disponível" : "giros disponíveis"}</span>
          <button type="button" onClick={girar} disabled={!podeGirar} className="jogo-botao-ouro min-w-32">
            {girando ? "Girando..." : "Girar"}
          </button>
        </div>
        {erro && <p className="relative z-10 mt-3 rounded-xl bg-red-50 p-3 text-center text-sm text-red-700" role="alert">{erro}</p>}
        <Particulas ref={particulas} className="z-20" />
      </div>

      {fichas === 0 && !girando && !resultado && !campanha && (
        <div className="mt-4 text-center text-xs text-zinc-500">
          {jogo.comoGanhar.length ? jogo.comoGanhar.join(" · ") : "Volte depois do próximo atendimento."}
          {jogo.proximaGratisEm && <> · Próximo giro grátis em {new Date(jogo.proximaGratisEm).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}</>}
        </div>
      )}

      {resultado && (
        <ModalResultado jogada={resultado} aoFechar={fechar} campanha={campanha}
          fichasRestantes={fichas} jogarDeNovo={fichas > 0 ? () => { setResultado(null); setVencedora(null); setTimeout(girar, 150); } : undefined} />
      )}
    </div>
  );
}
