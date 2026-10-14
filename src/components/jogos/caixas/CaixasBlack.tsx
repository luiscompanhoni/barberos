"use client";

/**
 * Escolha da caixa (Black, Gold, Legend...): cada nivel vem do servidor (raridade, premios por jogada, vitrine,
 * caixas disponiveis). Toque abre a AberturaCaixa; jogada pendente (pagina atualizada no meio) abre direto.
 */
import { useState } from "react";
import { Gift, Lock } from "lucide-react";
import { ROTULO_RARIDADE, type JogadaCliente, type JogoCliente } from "@/lib/jogos/tipos";
import { som, vibrar } from "../kit/som";
import { IconePremio } from "../kit/IconePremio";
import { AberturaCaixa } from "./AberturaCaixa";
import { CaixaArte } from "./CaixaArte";
import css from "./caixas.module.css";

const ORDEM = { COMUM: 0, RARO: 1, EPICO: 2, LENDARIO: 3 } as const;

type Aberta = { jogo: JogoCliente; pendente: JogadaCliente | null; fichas: number; vez: number };

export function CaixasBlack({ jogos, aoAtualizar }: { jogos: JogoCliente[]; aoAtualizar?: () => void }) {
  const [aberta, setAberta] = useState<Aberta | null>(null);
  const niveis = [...jogos].sort((a, b) => ORDEM[a.raridade] - ORDEM[b.raridade] || a.premiosPorJogada - b.premiosPorJogada);

  const abrir = (j: JogoCliente) => {
    som.destravar();
    som.clique();
    vibrar(10);
    // fotografia do momento: a tela de abertura conta as caixas sozinha ate fechar
    setAberta((a) => ({ jogo: j, pendente: j.pendente, fichas: j.fichas, vez: (a?.vez ?? 0) + 1 }));
  };

  if (!niveis.length) return null;

  return (
    <>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {niveis.map((j) => {
          const n = j.premiosPorJogada;
          const guardada = !!j.pendente;
          const pode = guardada || j.fichas > 0;
          return (
            <article
              key={j.id}
              data-raridade={j.raridade}
              data-pendente={guardada ? "1" : "0"}
              className={`jogo-palco jogo-fumaca ${css.tier} flex flex-col items-center px-5 pb-5 pt-4 text-center`}
            >
              <span className="jogo-selo relative z-10 self-start">{ROTULO_RARIDADE[j.raridade]}</span>

              <button
                type="button"
                onClick={() => pode && abrir(j)}
                disabled={!pode}
                aria-label={`Abrir ${j.nome}`}
                className="relative z-10 mt-1 block w-[min(62vw,200px)] disabled:cursor-default"
              >
                <div className={css.flutuar}>
                  <CaixaArte raridade={j.raridade} />
                </div>
              </button>

              <h3 className="jogo-titulo relative z-10 mt-2 text-2xl">{j.nome}</h3>
              <p className="jogo-subtitulo relative z-10 mt-1.5">{n} {n === 1 ? "prêmio garantido" : "prêmios garantidos"}</p>
              {j.descricao && <p className="relative z-10 mt-2 text-xs leading-snug text-[#a39d95]">{j.descricao}</p>}

              {j.vitrine.length > 0 && (
                <ul className="relative z-10 mt-4 flex flex-wrap justify-center gap-2" aria-label="Prêmios possíveis">
                  {j.vitrine.slice(0, 5).map((v) => (
                    <li key={v.id} data-raridade={v.raridade} className={css.vitrineItem} title={`${v.rotulo} · ${ROTULO_RARIDADE[v.raridade]}`}>
                      <IconePremio icone={v.icone} tamanho={20} traco={1.5} />
                      <span className="sr-only">{v.rotulo} ({ROTULO_RARIDADE[v.raridade]})</span>
                    </li>
                  ))}
                </ul>
              )}

              <p className="jogo-contador relative z-10 mt-4">
                <b>{j.fichas}</b> {j.fichas === 1 ? "caixa disponível" : "caixas disponíveis"}
              </p>

              <div className="relative z-10 mt-4 w-full">
                {guardada ? (
                  <button type="button" onClick={() => abrir(j)} className={`jogo-botao-ouro w-full ${css.pulsar}`}>
                    <Gift size={18} /> Abrir prêmio guardado
                  </button>
                ) : (
                  <button type="button" onClick={() => abrir(j)} disabled={!pode} className="jogo-botao-ouro w-full">
                    {pode ? "Abrir" : <><Lock size={16} /> Sem caixas</>}
                  </button>
                )}
              </div>

              {!pode && j.comoGanhar.length > 0 && (
                <ul className="relative z-10 mt-3 grid gap-1 text-left text-[11px] leading-snug text-[#a39d95]">
                  {j.comoGanhar.map((t) => (
                    <li key={t} className="flex gap-1.5"><span className="text-[#e9c46a]">•</span>{t}</li>
                  ))}
                </ul>
              )}
            </article>
          );
        })}
      </div>

      {aberta && (
        <AberturaCaixa
          key={`${aberta.jogo.id}-${aberta.vez}`}
          jogo={{ ...aberta.jogo, fichas: aberta.fichas }}
          pendente={aberta.pendente}
          aoFechar={() => setAberta(null)}
          aoTerminar={aoAtualizar}
        />
      )}
    </>
  );
}
