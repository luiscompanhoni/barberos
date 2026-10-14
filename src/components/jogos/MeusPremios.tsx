"use client";

/**
 * "Meus prêmios": tudo que o cliente ganhou nos jogos, com o codigo para mostrar no balcao, a validade,
 * o horario reservado e o historico (utilizado, expirado, cancelado). O premio nunca some da lista.
 */
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { CalendarCheck, CalendarPlus, Copy, Sparkles } from "lucide-react";
import { api, reais } from "@/lib/cliente-api";
import { descricaoPremio, ROTULO_RARIDADE, ROTULO_STATUS, type PremioCliente } from "@/lib/jogos/tipos";
import { IconePremio } from "./kit/IconePremio";

const data = (d: string, hora = false) =>
  new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", ...(hora ? { hour: "2-digit", minute: "2-digit" } : {}), timeZone: "America/Sao_Paulo" });

export function MeusPremios() {
  const destaque = useSearchParams().get("destaque");
  const [ps, setPs] = useState<PremioCliente[] | null>(null);
  const [erro, setErro] = useState("");
  const [copiado, setCopiado] = useState("");
  useEffect(() => { api<PremioCliente[]>("/api/cliente/premios").then(setPs).catch((e) => setErro(e.message)); }, []);
  useEffect(() => {
    if (destaque && ps) document.getElementById(`premio-${destaque}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [destaque, ps]);
  if (!ps) return <p className="py-16 text-center text-sm text-zinc-500">{erro || "Carregando seus prêmios..."}</p>;

  const abertos = ps.filter((p) => p.tipo !== "CREDITO" && (p.status === "DISPONIVEL" || p.status === "RESERVADO"));
  const historico = ps.filter((p) => !abertos.includes(p));

  async function copiar(c: string) {
    try { await navigator.clipboard.writeText(c); setCopiado(c); setTimeout(() => setCopiado(""), 1500); } catch { /* sem area de transferencia */ }
  }

  return (
    <div className="entrar-suave space-y-6">
      <div>
        <p className="jogo-subtitulo">Black Barber</p>
        <h1 className="jogo-titulo mt-1 text-4xl">Meus prêmios</h1>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-500">Para usar na barbearia</h2>
        {!abertos.length && (
          <div className="jogo-palco p-6 text-center text-sm text-zinc-600">
            Nenhum prêmio esperando. <Link href="/c/jogos" className="font-bold text-[#e9c46a]">Ver os jogos</Link>
          </div>
        )}
        {abertos.map((p) => (
          <article key={p.id} id={`premio-${p.id}`} className={`jogo-palco p-4 ${destaque === p.id ? "ring-2 ring-[#e9c46a]" : ""}`}>
            <div className="relative z-10 flex items-center gap-4">
              <span className={`jogo-carta raridade-${p.raridade} !w-16 shrink-0 !p-2`}><span className="jogo-carta-icone !m-0"><IconePremio icone={p.icone} tamanho={30} /></span></span>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#c9a24a]">{ROTULO_RARIDADE[p.raridade]}</p>
                <p className="text-lg font-black leading-tight">{p.rotulo}</p>
                <p className="text-xs text-zinc-500">{descricaoPremio(p)}</p>
              </div>
            </div>
            <div className="relative z-10 mt-4 flex items-center justify-between gap-3 rounded-xl bg-black/50 px-4 py-3 shadow-[inset_0_0_0_1px_rgba(233,196,106,.25)]">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">Código</p>
                <p className="font-mono text-2xl font-black tracking-[0.12em] text-[#f6e7b0]">{p.codigo}</p>
              </div>
              <button type="button" onClick={() => copiar(p.codigo)} className="jogo-botao-redondo" aria-label="Copiar código">
                {copiado === p.codigo ? <Sparkles size={16} /> : <Copy size={16} />}
              </button>
            </div>
            <div className="relative z-10 mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
              {p.status === "RESERVADO" && p.agendamento ? (
                <span className="flex items-center gap-1.5 font-semibold text-emerald-700"><CalendarCheck size={15} /> Reservado para {data(p.agendamento.inicio, true)}</span>
              ) : (
                <span className="text-zinc-500">{p.expiraEm ? `Válido até ${data(p.expiraEm)}` : "Sem validade"}</span>
              )}
              {p.status === "DISPONIVEL" && <Link href={`/c/agendar?premio=${p.id}`} className="jogo-botao-ouro !min-h-10 !px-4 !text-xs"><CalendarPlus size={15} /> Agendar para utilizar</Link>}
            </div>
          </article>
        ))}
        <p className="text-xs text-zinc-500">Mostre o código na recepção no dia do atendimento. Prêmios em dinheiro vão direto para o seu <Link href="/c/saldo" className="font-bold text-[#e9c46a]">saldo</Link>.</p>
      </section>

      {historico.length > 0 && (
        <section>
          <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-500">Histórico</h2>
          <ul className="mt-2 space-y-1.5">
            {historico.map((p) => (
              <li key={p.id} id={`premio-${p.id}`} className="flex items-center gap-3 rounded-xl bg-zinc-50 px-3 py-2.5 text-sm">
                <IconePremio icone={p.icone} tamanho={18} cor="#8b857e" />
                <span className="w-12 text-[11px] text-zinc-500">{data(p.criadoEm)}</span>
                <span className="min-w-0 flex-1 font-semibold">{p.tipo === "CREDITO" ? `${reais(p.valorCentavos)} no saldo` : p.rotulo}</span>
                <span className={`text-[11px] font-bold ${p.status === "UTILIZADO" ? "text-emerald-700" : "text-zinc-500"}`}>{p.tipo === "CREDITO" ? "Creditado" : ROTULO_STATUS[p.status]}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
