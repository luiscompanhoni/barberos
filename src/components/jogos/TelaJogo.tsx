"use client";

/**
 * Tela de um jogo da area do cliente: carrega a central (jogadas, vitrine, pendente) e mostra o jogo certo.
 * "caixas" junta os niveis de caixa (Black, Gold, Legend) numa tela so.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { api } from "@/lib/cliente-api";
import type { CentralJogos } from "@/lib/jogos/tipos";
import { CaixasBlack } from "./caixas/CaixasBlack";
import { RaspadinhaBlack } from "./raspadinha/RaspadinhaBlack";
import { RoletaBlack } from "./roleta/RoletaBlack";

export function TelaJogo({ id }: { id: string }) {
  const [c, setC] = useState<CentralJogos | null>(null);
  const [erro, setErro] = useState("");
  // Recarregar troca a chave: o jogo remonta com as jogadas atualizadas (sem pendente antigo).
  const [versao, setVersao] = useState(0);
  const carregar = useCallback(() => api<CentralJogos>("/api/cliente/jogos").then((x) => { setC(x); setVersao((v) => v + 1); }).catch((e) => setErro(e.message)), []);
  useEffect(() => { void carregar(); }, [carregar]);

  const voltar = <Link href="/c/jogos" className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-zinc-500"><ChevronLeft size={16} /> Jogos</Link>;
  if (!c) return <div>{voltar}<p className="py-16 text-center text-sm text-zinc-500">{erro || "Carregando..."}</p></div>;

  if (id === "caixas") {
    const caixas = c.jogos.filter((j) => j.tipo === "CAIXA");
    return <div>{voltar}{caixas.length ? <CaixasBlack key={versao} jogos={caixas} aoAtualizar={carregar} /> : <ForaDoAr />}</div>;
  }
  const jogo = c.jogos.find((j) => j.id === id);
  if (!jogo) return <div>{voltar}<ForaDoAr /></div>;
  return (
    <div>
      {voltar}
      {jogo.tipo === "ROLETA" && <RoletaBlack key={versao} jogo={{ ...jogo, multiplicador: c.multiplicador, assinante: c.assinante }} aoTerminar={carregar} />}
      {jogo.tipo === "RASPADINHA" && <RaspadinhaBlack key={versao} jogo={jogo} aoTerminar={carregar} />}
      {jogo.tipo === "CAIXA" && <CaixasBlack key={versao} jogos={[jogo]} aoAtualizar={carregar} />}
    </div>
  );
}

function ForaDoAr() {
  return <p className="jogo-palco p-8 text-center text-sm text-zinc-600">Esse jogo está fora do ar no momento. Volte já já!</p>;
}
