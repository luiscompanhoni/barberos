"use client";

/**
 * Chamada dos jogos na tela inicial do cliente: jogadas esperando e premios para usar (com o codigo).
 * Sem jogada nem premio, nao aparece (a tela inicial nao fica cheia).
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { CalendarPlus, ChevronRight, Sparkles } from "lucide-react";
import { api } from "@/lib/cliente-api";
import type { CentralJogos, PremioCliente } from "@/lib/jogos/tipos";
import { IconePremio } from "./kit/IconePremio";

const ate = (d: string) => new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });

export function JogosChamada() {
  const [c, setC] = useState<CentralJogos | null>(null);
  const [premios, setPremios] = useState<PremioCliente[]>([]);
  useEffect(() => {
    api<CentralJogos>("/api/cliente/jogos").then(setC).catch(() => setC(null));
    api<PremioCliente[]>("/api/cliente/premios").then((ps) => setPremios(ps.filter((p) => p.status === "DISPONIVEL" || p.status === "RESERVADO"))).catch(() => {});
  }, []);
  if (!c) return null;
  const jogadas = c.jogos.reduce((t, j) => t + j.fichas, 0);
  const pendentes = c.jogos.filter((j) => j.pendente).length;
  const usar = premios.filter((p) => p.tipo !== "CREDITO");
  if (!jogadas && !pendentes && !usar.length) return null;

  return (
    <section className="jogo-palco jogo-fumaca space-y-3 p-5">
      {(jogadas > 0 || pendentes > 0) && (
        <Link href="/c/jogos" className="relative z-10 flex items-center gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-black text-[#e9c46a] shadow-[inset_0_0_0_1px_rgba(233,196,106,.45)]">
            <Sparkles size={22} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="jogo-titulo block text-2xl">{pendentes ? "Prêmio para revelar" : `${jogadas} ${jogadas === 1 ? "jogada" : "jogadas"}`}</span>
            <span className="mt-1 block text-sm text-zinc-600">{pendentes ? "Sua jogada ficou guardada: toque para ver." : "Roleta, caixas e raspadinha esperando por você."}</span>
          </span>
          <ChevronRight className="text-[#e9c46a]" />
        </Link>
      )}
      {usar.slice(0, 3).map((p) => (
        <Link key={p.id} href={`/c/premios?destaque=${p.id}`} className="relative z-10 flex items-center gap-3 rounded-xl bg-black/40 p-3 text-sm shadow-[inset_0_0_0_1px_rgba(233,196,106,.2)]">
          <IconePremio icone={p.icone} tamanho={22} cor="#E9C46A" />
          <span className="min-w-0 flex-1">
            <b>{p.rotulo}</b>
            <span className="text-zinc-500"> · {p.status === "RESERVADO" && p.agendamento ? `reservado para ${ate(p.agendamento.inicio)}` : p.expiraEm ? `até ${ate(p.expiraEm)}` : "disponível"}</span>
          </span>
          <span className="font-mono text-xs tracking-wider text-[#e9c46a]">{p.codigo}</span>
        </Link>
      ))}
      {usar.some((p) => p.status === "DISPONIVEL") && (
        <Link href={`/c/agendar?premio=${usar.find((p) => p.status === "DISPONIVEL")!.id}`} className="jogo-botao-ouro relative z-10 w-full">
          <CalendarPlus size={17} /> Agendar para resgatar
        </Link>
      )}
    </section>
  );
}
