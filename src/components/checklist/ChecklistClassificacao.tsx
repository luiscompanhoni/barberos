"use client";

import { useCallback, useEffect, useState } from "react";
import { SlidersHorizontal, Trophy } from "lucide-react";
import { api } from "@/lib/cliente-api";
import { ProgressoNivel, SeloNivel, type Nivel } from "./SeloNivel";

type Lanc = { id: string; pontos: number; descricao: string; porNome: string | null; criadoEm: string };
type Linha = { id: string; nome: string; funcao: string; pontos: number; pontosMes: number; nivel: Nivel; proximo: Nivel | null; faltam: number; percentual: number; extrato: Lanc[] };
type Dados = { config: { pontosRe: number; nivelPlatina: number; nivelLegend: number }; mes: string; pessoas: Linha[] };

const FUNCAO: Record<string, string> = { DIARISTA: "Diarista", BARBEIRO: "Barbeiro", GERENTE: "Gerente" };
const dataCurta = (d: string) => new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });
const sinal = (n: number) => (n > 0 ? `+${n}` : `${n}`);

/** Ranking da equipe por pontos do checklist, com faixa, progresso e ajuste manual. */
export function ChecklistClassificacao() {
  const [d, setD] = useState<Dados | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  const [ajuste, setAjuste] = useState({ pontos: "", motivo: "" });
  const [msg, setMsg] = useState<{ t: string; erro?: boolean } | null>(null);

  const carregar = useCallback(() => {
    api<Dados>("/api/checklist/pontos").then(setD).catch((e) => setMsg({ t: e.message, erro: true }));
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  async function ajustar(pessoaId: string) {
    const pontos = Number(ajuste.pontos);
    if (!Number.isInteger(pontos) || !pontos) return setMsg({ t: "Informe os pontos (ex.: 15 ou -10).", erro: true });
    try {
      await api("/api/checklist/pontos", { method: "POST", body: { pessoaId, pontos, motivo: ajuste.motivo } });
      setAjuste({ pontos: "", motivo: "" });
      setMsg({ t: "Ajuste lançado." });
      carregar();
    } catch (e) {
      setMsg({ t: (e as Error).message, erro: true });
    }
  }

  if (!d) return <div className="cartao text-sm text-zinc-500">{msg?.t ?? "Carregando…"}</div>;
  const [, m] = d.mes.split("-");
  return (
    <div className="space-y-3">
      {msg && <p className={`rounded-xl p-3 text-sm ${msg.erro ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"}`}>{msg.t}</p>}
      <div className="cartao flex flex-wrap items-center gap-2 text-xs text-zinc-500">
        <SeloNivel nivel="ELITE" pequeno /> até {d.config.nivelPlatina - 1} pts
        <SeloNivel nivel="PLATINA" pequeno /> a partir de {d.config.nivelPlatina}
        <SeloNivel nivel="LEGEND" pequeno /> a partir de {d.config.nivelLegend}
        <span className="ml-auto">Ré: −{d.config.pontosRe} pts</span>
      </div>
      {d.pessoas.length === 0 && <div className="cartao text-sm text-zinc-500">Ninguém cadastrado no checklist ainda.</div>}
      <ol className="space-y-2">
        {d.pessoas.map((p, n) => (
          <li key={p.id} className={n === 0 && p.pontos > 0 ? "cartao-destaque space-y-2" : "cartao space-y-2"}>
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 font-black text-ouro">{n === 0 && p.pontos > 0 ? <Trophy size={16} /> : n + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{p.nome}</p>
                <p className="text-xs text-zinc-500">{FUNCAO[p.funcao]} · {sinal(p.pontosMes)} pts no mês {m}</p>
              </div>
              <SeloNivel nivel={p.nivel} />
              <p className="w-20 text-right text-xl font-black tabular-nums">{p.pontos}<span className="ml-0.5 text-xs font-semibold text-zinc-500">pts</span></p>
              <button className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100" title="Extrato e ajuste manual" onClick={() => setAberto(aberto === p.id ? null : p.id)}><SlidersHorizontal size={15} /></button>
            </div>
            <ProgressoNivel percentual={p.percentual} proximo={p.proximo} faltam={p.faltam} />
            {aberto === p.id && (
              <div className="space-y-2 border-t border-zinc-200 pt-2">
                {p.extrato.length === 0 ? <p className="text-xs text-zinc-500">Sem lançamentos ainda.</p> : (
                  <ul className="space-y-0.5 text-xs">
                    {p.extrato.map((l) => (
                      <li key={l.id} className="flex gap-2">
                        <span className="w-10 text-zinc-500">{dataCurta(l.criadoEm)}</span>
                        <span className="flex-1">{l.descricao}{l.porNome ? <span className="text-zinc-500"> · {l.porNome}</span> : null}</span>
                        <span className={`font-bold tabular-nums ${l.pontos < 0 ? "text-red-600" : "text-emerald-600"}`}>{sinal(l.pontos)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex flex-wrap items-end gap-2">
                  <div><label className="rotulo">Pontos</label><input className="campo w-24 py-1.5" inputMode="numeric" placeholder="+15 / -10" value={ajuste.pontos} onChange={(e) => setAjuste({ ...ajuste, pontos: e.target.value.replace(/[^\d-]/g, "") })} /></div>
                  <div className="min-w-40 flex-1"><label className="rotulo">Motivo</label><input className="campo py-1.5" placeholder="Ex.: ajudou a fechar a loja" value={ajuste.motivo} onChange={(e) => setAjuste({ ...ajuste, motivo: e.target.value })} /></div>
                  <button className="btn" onClick={() => ajustar(p.id)}>Lançar ajuste</button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
