"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CalendarPlus, Sparkles } from "lucide-react";
import { AberturaCaixa } from "@/components/jogos/caixas/AberturaCaixa";
import { CaixaArte } from "@/components/jogos/caixas/CaixaArte";
import { som } from "@/components/jogos/kit/som";
import { RaspadinhaBlack } from "@/components/jogos/raspadinha/RaspadinhaBlack";
import { RoletaBlack } from "@/components/jogos/roleta/RoletaBlack";
import { Marca } from "@/components/Marca";
import type { Landing } from "@/lib/campanhas/link";
import { ErroApi } from "@/lib/cliente-api";
import type { JogadaCliente } from "@/lib/jogos/tipos";

const enviar = async (token: string, acao: "visita" | "jogar") => {
  const r = await fetch(`/api/r/${token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ acao }) });
  const corpo = await r.json().catch(() => ({}));
  if (!r.ok) throw new ErroApi(corpo.erro ?? "Não deu para jogar agora.", r.status, corpo.codigo);
  return corpo;
};

/**
 * Pagina do link da campanha (sem login). Avisa a visita pelo JavaScript (robo de previa de link nao conta).
 * Campanha com jogo: 1 jogada de presente (roleta, caixa ou raspadinha) e o convite para agendar e usar.
 * Abrir de novo mostra o mesmo premio. Campanha comum: vai direto para agendar.
 */
export function LandingCampanha({ token, dados }: { token: string; dados: Landing }) {
  const j = dados.jogo;
  useEffect(() => {
    const visita = enviar(token, "visita").catch(() => null);
    if (!j) visita.finally(() => window.location.replace("/c/agendar"));
  }, [token, j]);

  return (
    <main className="flex flex-1 items-start justify-center px-4 py-8">
      <section className="entrar-suave w-full max-w-md space-y-5">
        <div className="flex justify-center"><Marca nome={dados.barbearia} /></div>
        {!j ? (
          <div className="text-center">
            <p className="text-lg font-bold">{dados.nome ? `Oi, ${dados.nome}!` : "Oi!"}</p>
            <p className="mt-2 text-sm text-zinc-600">Abrindo a agenda da {dados.barbearia}…</p>
            <Link className="btn-primario mt-6 w-full py-3.5" href="/c/agendar"><CalendarPlus size={17} /> Agendar agora</Link>
          </div>
        ) : (
          <Presente token={token} dados={dados} jogo={j} />
        )}
      </section>
    </main>
  );
}

function Presente({ token, dados, jogo }: { token: string; dados: Landing; jogo: NonNullable<Landing["jogo"]> }) {
  const jogar = useMemo(() => async () => (await enviar(token, "jogar")).jogada as JogadaCliente, [token]);
  const [abrindo, setAbrindo] = useState(false);
  const [terminou, setTerminou] = useState(!!jogo.jogada);
  const base = { id: jogo.id, nome: jogo.nome, comoGanhar: [], vitrine: jogo.vitrine, pendente: jogo.jogada, fichas: jogo.jogada ? 0 : 1 };

  return (
    <div className="space-y-4">
      <div className="text-center">
        <h1 className="text-2xl font-black">{dados.nome ? `${dados.nome}, ` : ""}você ganhou um presente! <Sparkles className="inline text-ouro" size={20} /></h1>
        <p className="mt-1 text-sm text-zinc-600">Da {dados.barbearia}: 1 jogada na {jogo.nome}.{jogo.jogada ? " Veja de novo o que saiu." : ""}</p>
      </div>

      {!jogo.ativo && !jogo.jogada ? (
        <p className="cartao text-center text-sm">O jogo está pausado agora. Que tal já garantir seu horário?</p>
      ) : jogo.vencido ? (
        <p className="cartao text-center text-sm">Esse presente venceu. Mas a agenda está aberta para você!</p>
      ) : jogo.tipo === "ROLETA" ? (
        <RoletaBlack jogo={{ ...base, fatias: jogo.fatias, proximaGratisEm: null, multiplicador: jogo.multiplicador }} jogar={jogar} campanha aoTerminar={() => setTerminou(true)} />
      ) : jogo.tipo === "RASPADINHA" ? (
        <RaspadinhaBlack jogo={base} jogar={jogar} campanha aoTerminar={() => setTerminou(true)} />
      ) : (
        <div className="jogo-palco jogo-fumaca grid place-items-center gap-4 p-6">
          <CaixaArte raridade={jogo.raridade} className="relative z-10 h-44 w-44" aura />
          <button type="button" className="jogo-botao-ouro relative z-10 w-full" onClick={() => { som.destravar(); som.clique(); setAbrindo(true); }}>
            {jogo.jogada ? "Ver meu prêmio" : `Abrir a ${jogo.nome}`}
          </button>
        </div>
      )}
      {abrindo && (
        <AberturaCaixa jogo={{ id: jogo.id, nome: jogo.nome, raridade: jogo.raridade, premiosPorJogada: jogo.premiosPorJogada, fichas: 1 }}
          pendente={jogo.jogada} jogar={jogar} campanha aoFechar={() => setAbrindo(false)} aoTerminar={() => setTerminou(true)} />
      )}

      {(terminou || !jogo.ativo || jogo.vencido) && (
        <Link className="btn-primario w-full py-3.5" href="/c/agendar">
          <CalendarPlus size={17} /> Agendar meu horário
        </Link>
      )}
      <p className="text-center text-xs text-zinc-500">Para agendar e usar, entre com o seu número de WhatsApp: o prêmio já está nele.</p>
    </div>
  );
}
