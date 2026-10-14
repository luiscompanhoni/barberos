"use client";

/**
 * Pede a jogada ao servidor (que decide e grava o premio) e guarda a chave de idempotencia no aparelho ate a
 * animacao terminar. Se a conexao cair no meio, tentar de novo usa a MESMA chave (nao gasta outra jogada);
 * se a pagina atualizar, a jogada volta do servidor como "pendente" e e revelada de novo.
 */
import { useCallback, useRef, useState } from "react";
import { api, ErroApi } from "@/lib/cliente-api";
import type { JogadaCliente } from "@/lib/jogos/tipos";
import { som } from "./som";

const chaveSalva = (jogoId: string) => `bb-jogada:${jogoId}`;

function lerChave(jogoId: string) {
  try { return sessionStorage.getItem(chaveSalva(jogoId)); } catch { return null; }
}
function gravarChave(jogoId: string, v: string | null) {
  try { if (v) sessionStorage.setItem(chaveSalva(jogoId), v); else sessionStorage.removeItem(chaveSalva(jogoId)); } catch { /* ok */ }
}
function novaChave() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export type Jogar = () => Promise<JogadaCliente>;

/**
 * `jogoId` do jogo; `jogar` opcional substitui a chamada padrao (ex.: link da campanha, sem login);
 * `revelarNoServidor` = false quando nao ha sessao (campanha).
 */
export function useJogada(jogoId: string, o: { jogar?: Jogar; revelarNoServidor?: boolean } = {}) {
  const [jogada, setJogada] = useState<JogadaCliente | null>(null);
  const [pedindo, setPedindo] = useState(false);
  const [erro, setErro] = useState("");
  const ocupado = useRef(false);

  const pedir = useCallback(async (): Promise<JogadaCliente | null> => {
    if (ocupado.current) return null; // clique repetido: ignora
    ocupado.current = true;
    som.destravar();
    setErro("");
    setPedindo(true);
    const chave = lerChave(jogoId) ?? novaChave();
    gravarChave(jogoId, chave);
    try {
      for (let tentativa = 0; ; tentativa++) {
        try {
          const j = o.jogar ? await o.jogar() : await api<JogadaCliente>(`/api/cliente/jogos/${jogoId}/jogar`, { method: "POST", body: { chave } });
          setJogada(j);
          return j;
        } catch (e) {
          // Sem resposta (rede caiu): tenta de novo com a mesma chave; erro da regra (sem jogadas...) nao repete.
          if (e instanceof ErroApi || tentativa >= 2) throw e;
          await new Promise((r) => setTimeout(r, 800 * (tentativa + 1)));
        }
      }
    } catch (e) {
      if (e instanceof ErroApi) gravarChave(jogoId, null);
      setErro(e instanceof ErroApi ? e.message : "A conexão caiu. Seu prêmio fica guardado: tente de novo ou volte em instantes.");
      return null;
    } finally {
      setPedindo(false);
      ocupado.current = false;
    }
  }, [jogoId, o]);

  /** Retoma uma jogada que o servidor devolveu como pendente (pagina atualizada no meio da animacao). */
  const retomar = useCallback((j: JogadaCliente) => { setJogada(j); }, []);

  /** A animacao terminou: avisa o servidor e libera a chave. */
  const revelar = useCallback(async (j: JogadaCliente) => {
    gravarChave(jogoId, null);
    if (o.revelarNoServidor === false) return;
    await api(`/api/cliente/jogadas/${j.id}/revelar`, { method: "POST" }).catch(() => {});
  }, [jogoId, o.revelarNoServidor]);

  const limpar = useCallback(() => setJogada(null), []);

  return { jogada, pedindo, erro, pedir, retomar, revelar, limpar, setErro };
}
