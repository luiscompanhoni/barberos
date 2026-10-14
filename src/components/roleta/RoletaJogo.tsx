"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarPlus, Coins, Dices, Gift, History, Sparkles, X } from "lucide-react";
import { api, reais } from "@/lib/cliente-api";
import { RodaRoleta, rotacaoAlvo, type Fatia } from "./RodaRoleta";

type Premio = Fatia & { tipo: "CREDITO" | "BRINDE" | "NADA"; valorCentavos: number };
type Estado = {
  ativa: boolean;
  premios: Premio[];
  giros: number;
  proximoGratisEm: string | null;
  girosPorAtendimento: number;
  multiplicador: number;
  assinante: boolean;
  aRetirar: { id: string; rotulo: string; expiraEm: string | null }[];
  historico: { id: string; rotulo: string; tipo: string; valorCentavos: number; status: string; criadoEm: string }[];
};
type Resultado = { premioId: string; rotulo: string; tipo: Premio["tipo"]; valorBaseCentavos: number; multiplicador: number; valorCentavos: number; expiraEm: string | null };
type Aba = "girar" | "premios" | "historico";

const dataCurta = (d: string) => new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });
const valorCurto = (c: number) => (c % 100 ? (c / 100).toFixed(2).replace(".", ",") : String(c / 100));

/** Jogo da roleta da area do cliente. */
export function RoletaJogo() {
  const [e, setE] = useState<Estado | null>(null);
  const [aba, setAba] = useState<Aba>("girar");
  const [rotacao, setRotacao] = useState(0);
  const [girando, setGirando] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [mostrar, setMostrar] = useState(false);
  const [destaque, setDestaque] = useState<number | null>(null);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  // Ganhou algo para usar na barbearia: mostra "Agendar para resgatar" depois de coletar.
  const [resgatar, setResgatar] = useState(false);
  const indice = useRef<number | null>(null);

  const carregar = useCallback(() => api<Estado>("/api/cliente/roleta").then(setE).catch((x) => setErro(x.message)), []);
  useEffect(() => { carregar(); }, [carregar]);

  async function girar() {
    if (!e || girando) return;
    setErro(""); setAviso(""); setResgatar(false); setResultado(null); setMostrar(false); setDestaque(null);
    try {
      const r = await api<Resultado>("/api/cliente/roleta/girar", { method: "POST" });
      const i = Math.max(0, e.premios.findIndex((p) => p.id === r.premioId));
      setResultado(r);
      setGirando(true);
      setRotacao((atual) => rotacaoAlvo(atual, i, e.premios.length, Math.random() * 2 - 1));
      setDestaque(null);
      setE({ ...e, giros: Math.max(0, e.giros - 1) });
      indice.current = i;
    } catch (x) {
      setErro((x as Error).message);
    }
  }

  function parou() {
    if (!girando) return;
    setGirando(false);
    setDestaque(indice.current);
    setMostrar(true);
  }

  function coletar() {
    if (!resultado) return;
    setAviso(
      resultado.tipo === "CREDITO" ? `${reais(resultado.valorCentavos)} já estão no seu saldo! Use no próximo atendimento.`
        : resultado.tipo === "BRINDE" ? `Seu prêmio "${resultado.rotulo}" está guardado: mostre na barbearia para retirar.`
          : "Não foi dessa vez. No próximo atendimento você ganha mais giros!",
    );
    setResgatar(resultado.tipo !== "NADA");
    setResultado(null); setMostrar(false); setDestaque(null);
    carregar();
  }

  if (!e) return <p className="py-10 text-center text-sm text-zinc-500">{erro || "Carregando a roleta..."}</p>;

  const mult = (resultado?.multiplicador ?? e.multiplicador) / 100;
  const base = resultado ? (resultado.tipo === "CREDITO" ? resultado.valorBaseCentavos : 0) : 0;
  const total = resultado?.tipo === "CREDITO" ? resultado.valorCentavos : 0;
  const abas: { id: Aba; rotulo: string; Icone: typeof Gift; n?: number }[] = [
    { id: "premios", rotulo: "Prêmios", Icone: Gift, n: e.aRetirar.length },
    { id: "girar", rotulo: "Girar", Icone: Dices, n: e.giros },
    { id: "historico", rotulo: "Histórico", Icone: History },
  ];

  return (
    <div className="entrar-suave mx-auto max-w-lg">
      <div className="flex items-stretch">
        {/* abas laterais */}
        <div className="z-10 -mr-[3px] mt-20 flex w-14 shrink-0 flex-col gap-2 sm:w-16">
          {abas.map(({ id, rotulo, Icone, n }) => (
            <button key={id} onClick={() => setAba(id)}
              className={`roleta-aba relative flex flex-col items-center gap-0.5 rounded-l-xl py-2.5 text-[10px] font-bold ${aba === id ? "roleta-aba-ativa" : "text-[#e2e8f0]"}`}>
              <Icone size={20} className={aba === id ? "text-[#0d151d]" : "text-[#ffd21f]"} />
              {rotulo}
              {!!n && <span className="absolute -right-1 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full border-2 border-[#ffffff] bg-[#3ccf3c] px-1 text-[10px] font-black text-[#ffffff]">{n}</span>}
            </button>
          ))}
        </div>

        {/* moldura */}
        <section className="roleta-moldura relative min-w-0 flex-1 rounded-2xl px-3 pb-4 pt-3">
          <Link href="/c" aria-label="Fechar" className="absolute -right-2.5 -top-2.5 z-20 grid h-9 w-9 place-items-center rounded-full border-[3px] border-[#ffffff] bg-[#d32f2f] text-[#ffffff] shadow-lg">
            <X size={18} strokeWidth={3.5} />
          </Link>

          <div className="flex items-start justify-between">
            <h1 className="roleta-titulo text-[26px] sm:text-[32px]">
              Gire<br /><span className="text-[18px] sm:text-[22px]">e</span><br />Ganhe
              <Sparkles className="ml-1 inline text-[#fff3a6]" size={16} />
            </h1>
            <div className="mr-4 mt-1 flex flex-col items-center" title={e.assinante ? "Bônus de assinante" : "Assinantes ganham bônus nos prêmios em dinheiro"}>
              <div className={`roleta-vip grid h-11 w-11 place-items-center rounded-full text-[11px] font-black ${e.assinante ? "text-[#1d2a36]" : "text-zinc-500 opacity-70"}`}>VIP</div>
              <span className={`roleta-fita -mt-1.5 rounded px-1.5 text-[11px] font-black text-[#ffffff] ${e.assinante ? "" : "opacity-60"}`}>x{(e.multiplicador / 100).toFixed(1)}</span>
            </div>
          </div>

          {aba === "girar" && (
            <div className="relative mt-1">
              {!e.ativa ? (
                <p className="py-16 text-center text-sm font-semibold text-[#e2e8f0]">A roleta volta já já. Fique de olho! 🎡</p>
              ) : (
                <RodaRoleta fatias={e.premios} rotacao={rotacao} girando={girando} destaque={destaque}
                  onGirar={girar} podeGirar={e.giros > 0 && !resultado} aoParar={parou} />
              )}
              {mostrar && resultado && (
                <div className="roleta-surgir pointer-events-none absolute inset-x-0 top-[66%] z-20 text-center">
                  <span className="inline-block rounded-full bg-[#0b1117e6] px-4 py-1.5 shadow-lg">
                    <span className="roleta-titulo text-2xl not-italic">
                      {resultado.tipo === "NADA" ? "Quase!" : resultado.tipo === "CREDITO" ? `+ ${reais(total)}` : resultado.rotulo}
                    </span>
                  </span>
                </div>
              )}
            </div>
          )}

          {aba === "premios" && (
            <div className="mt-3 min-h-64 space-y-2">
              <p className="text-xs font-bold uppercase tracking-wider text-[#ffd21f]">Para retirar na barbearia</p>
              {e.aRetirar.length === 0 && <p className="py-8 text-center text-sm text-[#cbd5e1]">Nenhum brinde esperando por você.</p>}
              {e.aRetirar.map((p) => (
                <div key={p.id} className="flex items-center gap-3 rounded-xl bg-[#ffffff1a] p-3 text-sm text-[#ffffff]">
                  <Gift className="shrink-0 text-[#ffd21f]" size={20} />
                  <span className="flex-1 font-bold">{p.rotulo}</span>
                  {p.expiraEm && <span className="text-[11px] text-[#cbd5e1]">até {dataCurta(p.expiraEm)}</span>}
                </div>
              ))}
              <p className="pt-2 text-xs text-[#cbd5e1]">Prêmios em dinheiro vão direto para o seu <Link href="/c/saldo" className="font-bold text-[#ffd21f] underline">saldo</Link>.</p>
            </div>
          )}

          {aba === "historico" && (
            <ul className="mt-3 min-h-64 space-y-1.5">
              {e.historico.length === 0 && <li className="py-8 text-center text-sm text-[#cbd5e1]">Você ainda não girou a roleta.</li>}
              {e.historico.map((g) => (
                <li key={g.id} className="flex items-center gap-3 rounded-lg bg-[#ffffff0d] px-3 py-2 text-sm text-[#f1f5f9]">
                  <span className="w-11 text-[11px] text-[#94a3b8]">{dataCurta(g.criadoEm)}</span>
                  <span className="flex-1 font-semibold">{g.rotulo}</span>
                  <span className="text-xs text-[#ffd21f]">{g.tipo === "CREDITO" ? reais(g.valorCentavos) : g.tipo === "BRINDE" ? (g.status === "A_RETIRAR" ? "a retirar" : g.status === "EXPIRADO" ? "venceu" : "retirado") : "—"}</span>
                </li>
              ))}
            </ul>
          )}

          {/* barra de premio */}
          <div className="roleta-barra mt-4 flex items-center gap-1.5 rounded-2xl px-2.5 py-2.5 text-[#ffffff] sm:gap-3 sm:px-4">
            <div className="text-center leading-tight">
              <p className="text-lg font-black sm:text-xl">{resultado ? (resultado.tipo === "CREDITO" ? valorCurto(base) : resultado.tipo === "BRINDE" ? "🎁" : "0") : e.giros}</p>
              <p className="text-[10px] text-[#cbd5e1]">{resultado ? "Prêmio" : e.giros === 1 ? "Giro" : "Giros"}</p>
            </div>
            <span className="text-lg font-black text-[#94a3b8]">x</span>
            <div className="text-center leading-tight">
              <p className="text-lg font-black sm:text-xl">{mult.toFixed(1)}</p>
              <p className="text-[10px] text-[#cbd5e1]">{e.assinante ? "Bônus VIP" : "Bônus"}</p>
            </div>
            <span className="text-lg font-black text-[#94a3b8]">=</span>
            <div className="flex min-w-0 flex-1 items-center gap-1">
              <p className="text-xl font-black text-[#ffd21f] sm:text-2xl">{resultado?.tipo === "CREDITO" ? valorCurto(total) : resultado ? (resultado.tipo === "BRINDE" ? "Brinde" : "0") : "?"}</p>
              <Coins className="text-[#ffd21f]" size={22} />
            </div>
            <button onClick={resultado ? coletar : girar} disabled={girando || (!resultado && (e.giros <= 0 || !e.ativa))}
              className="roleta-coletar shrink-0 rounded-xl px-3 py-2.5 text-sm sm:px-6">
              {resultado ? "Resgatar" : "Girar"}
            </button>
          </div>
        </section>
      </div>

      {aviso && <p className="mt-4 rounded-xl bg-emerald-50 p-3 text-center text-sm font-semibold text-emerald-800">{aviso}</p>}
      {resgatar && (
        <Link href="/c/agendar" className="btn-primario mt-3 w-full py-3.5"><CalendarPlus size={17} /> Agendar para resgatar</Link>
      )}
      {erro && <p className="mt-4 rounded-xl bg-red-50 p-3 text-center text-sm text-red-700">{erro}</p>}
      <p className="mt-4 text-center text-xs text-zinc-500">
        Cada atendimento concluído vale {e.girosPorAtendimento === 1 ? "1 giro" : `${e.girosPorAtendimento} giros`}.
        {e.proximoGratisEm && ` Próximo giro grátis em ${dataCurta(e.proximoGratisEm)}.`}
        {!e.assinante && " Assinantes ganham bônus nos prêmios em dinheiro."}
      </p>
    </div>
  );
}
