"use client";

/**
 * Central de jogos do cliente: Roleta Black, Caixas-surpresa e Raspadinha, com as jogadas de cada um,
 * os melhores premios e o atalho para "Meus prêmios".
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronRight, Gift } from "lucide-react";
import { api } from "@/lib/cliente-api";
import type { CentralJogos as Central, JogoCliente } from "@/lib/jogos/tipos";
import { BotaoSom } from "./kit/BotaoSom";
import { IconePremio, Monograma } from "./kit/IconePremio";
import { som } from "./kit/som";

type Cartao = { href: string; titulo: string; sub: string; fichas: number; pendente: boolean; vitrine: JogoCliente["vitrine"]; arte: React.ReactNode; dica: string };

export function CentralJogos() {
  const [c, setC] = useState<Central | null>(null);
  const [erro, setErro] = useState("");
  useEffect(() => { api<Central>("/api/cliente/jogos").then(setC).catch((e) => setErro(e.message)); }, []);
  if (!c) return <p className="py-16 text-center text-sm text-zinc-500">{erro || "Carregando os jogos..."}</p>;

  const roleta = c.jogos.find((j) => j.tipo === "ROLETA");
  const caixas = c.jogos.filter((j) => j.tipo === "CAIXA");
  const raspa = c.jogos.find((j) => j.tipo === "RASPADINHA");
  const cartoes: Cartao[] = [
    ...(roleta ? [{ href: `/c/jogos/${roleta.id}`, titulo: roleta.nome, sub: "Gire e ganhe", fichas: roleta.fichas, pendente: !!roleta.pendente, vitrine: roleta.vitrine, arte: <ArteRoleta />, dica: roleta.comoGanhar[0] ?? "" }] : []),
    ...(caixas.length ? [{
      href: "/c/jogos/caixas", titulo: "Caixas-surpresa", sub: caixas.map((x) => x.nome.replace(/^Caixa\s+/i, "")).join(" · "),
      fichas: caixas.reduce((t, x) => t + x.fichas, 0), pendente: caixas.some((x) => x.pendente),
      vitrine: caixas.flatMap((x) => x.vitrine), arte: <ArteCaixa />, dica: caixas.flatMap((x) => x.comoGanhar)[0] ?? "",
    }] : []),
    ...(raspa ? [{ href: `/c/jogos/${raspa.id}`, titulo: raspa.nome, sub: "Raspe e combine 3", fichas: raspa.fichas, pendente: !!raspa.pendente, vitrine: raspa.vitrine, arte: <ArteRaspa />, dica: raspa.comoGanhar[0] ?? "" }] : []),
  ];

  return (
    <div className="entrar-suave space-y-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="jogo-subtitulo">Black Barber</p>
          <h1 className="jogo-titulo mt-1 text-4xl">Jogos</h1>
        </div>
        <BotaoSom />
      </div>

      <Link href="/c/premios" className="jogo-palco flex items-center gap-3 p-4">
        <Gift className="text-[#e9c46a]" size={22} />
        <span className="flex-1 text-sm"><b className="text-zinc-900">Meus prêmios</b>{c.premiosAtivos > 0 && <span className="text-zinc-500"> · {c.premiosAtivos} para usar</span>}</span>
        <ChevronRight className="text-[#e9c46a]" size={18} />
      </Link>

      {!cartoes.length && <p className="jogo-palco p-8 text-center text-sm text-zinc-600">Os jogos voltam já já. Fique de olho!</p>}

      <div className="grid gap-4 sm:grid-cols-2">
        {cartoes.map((k) => (
          <Link key={k.href} href={k.href} onClick={() => { som.destravar(); som.clique(); }} className="jogo-palco jogo-fumaca group flex flex-col p-5 transition hover:-translate-y-0.5">
            <div className="relative z-10 flex items-start justify-between">
              <div>
                <p className="jogo-subtitulo">{k.sub}</p>
                <h2 className="jogo-titulo mt-1 text-2xl">{k.titulo}</h2>
              </div>
              {k.pendente
                ? <span className="jogo-selo animate-pulse">Prêmio guardado</span>
                : <span className="jogo-contador"><b>{k.fichas}</b></span>}
            </div>
            <div className="relative z-10 my-4 grid h-36 place-items-center transition group-hover:scale-[1.03]">{k.arte}</div>
            <div className="relative z-10 flex items-center gap-2">
              {k.vitrine.slice(0, 4).map((p) => (
                <span key={p.id} title={p.rotulo} className={`grid h-9 w-9 place-items-center rounded-full bg-black/60 shadow-[inset_0_0_0_1px_rgba(233,196,106,.35)] ${p.raridade === "LENDARIO" ? "text-[#fff3c4]" : "text-[#c9a24a]"}`}>
                  <IconePremio icone={p.icone} tamanho={18} />
                </span>
              ))}
              <span className="ml-auto text-xs font-bold uppercase tracking-wider text-[#e9c46a]">{k.pendente ? "Revelar" : k.fichas ? "Jogar" : "Ver"} →</span>
            </div>
            {!k.fichas && !k.pendente && k.dica && <p className="relative z-10 mt-3 text-[11px] text-zinc-500">{k.dica}</p>}
          </Link>
        ))}
      </div>
      {c.assinante && c.multiplicador > 100 && <p className="text-center text-xs text-zinc-500">Assinante: prêmios em dinheiro valem x{(c.multiplicador / 100).toFixed(1)}.</p>}
    </div>
  );
}

/** Miniaturas originais de cada jogo (so desenho, sem animacao pesada). */
function ArteRoleta() {
  const cores = ["#2A2A2E", "#C9A24A", "#141416", "#8A6A3B", "#E6D3A3", "#2A2A2E", "#C9A24A", "#141416"];
  return (
    <svg viewBox="0 0 120 120" className="h-full drop-shadow-[0_8px_16px_rgba(0,0,0,.7)]" aria-hidden>
      <circle cx="60" cy="60" r="58" fill="#C9A24A" /><circle cx="60" cy="60" r="54" fill="#0b0b0c" />
      <g className="origin-center animate-[spin_14s_linear_infinite]" style={{ transformBox: "fill-box" }}>
        {cores.map((c, i) => {
          const a0 = (i * 45 - 90) * (Math.PI / 180), a1 = ((i + 1) * 45 - 90) * (Math.PI / 180);
          return <path key={i} d={`M60 60 L${60 + 50 * Math.cos(a0)} ${60 + 50 * Math.sin(a0)} A50 50 0 0 1 ${60 + 50 * Math.cos(a1)} ${60 + 50 * Math.sin(a1)} Z`} fill={c} stroke="#E9C46A" strokeOpacity=".6" />;
        })}
      </g>
      <circle cx="60" cy="60" r="15" fill="#0b0b0c" stroke="#E9C46A" strokeWidth="3" />
      <path d="M60 2 l7 14 h-14z" fill="#FFF3C4" />
    </svg>
  );
}
function ArteCaixa() {
  return (
    <svg viewBox="0 0 120 120" className="h-full animate-[bounce_3s_ease-in-out_infinite] drop-shadow-[0_10px_18px_rgba(0,0,0,.75)]" aria-hidden>
      <defs><linearGradient id="ac-o" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#FFF3C4" /><stop offset=".5" stopColor="#C9A24A" /><stop offset="1" stopColor="#6B4E17" /></linearGradient></defs>
      <path d="M20 46 60 30 100 46 60 62z" fill="#2a2a2e" stroke="url(#ac-o)" strokeWidth="2.5" />
      <path d="M20 46v40l40 18V62z" fill="#141416" stroke="url(#ac-o)" strokeWidth="2.5" />
      <path d="M100 46v40l-40 18V62z" fill="#1c1c1f" stroke="url(#ac-o)" strokeWidth="2.5" />
      <path d="M40 54 80 38" stroke="#FFF3C4" strokeOpacity=".5" strokeWidth="2" />
      <g transform="translate(25 63) scale(.42)"><Monograma tamanho={64} /></g>
    </svg>
  );
}
function ArteRaspa() {
  return (
    <svg viewBox="0 0 120 120" className="h-full drop-shadow-[0_8px_16px_rgba(0,0,0,.7)]" aria-hidden>
      <rect x="16" y="16" width="88" height="88" rx="10" fill="#0b0b0c" stroke="#C9A24A" strokeWidth="2.5" />
      {Array.from({ length: 9 }, (_, i) => (
        <rect key={i} x={24 + (i % 3) * 25} y={24 + Math.floor(i / 3) * 25} width="21" height="21" rx="4" fill={i === 4 || i === 0 || i === 8 ? "#E9C46A" : "#2a2a2e"} stroke="#5E4518" />
      ))}
      <path d="M22 98 98 22" stroke="#FFF3C4" strokeOpacity=".25" strokeWidth="6" strokeLinecap="round" />
    </svg>
  );
}
