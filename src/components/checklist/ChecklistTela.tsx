"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Circle, Copy, Send, ThumbsDown, ThumbsUp, Undo2 } from "lucide-react";
import { api } from "@/lib/cliente-api";
import { ChecklistCadastro } from "./ChecklistCadastro";
import { ChecklistClassificacao } from "./ChecklistClassificacao";
import { FotosTarefa } from "./FotosTarefa";

type Item = {
  id: string; titulo: string; horario: string | null; feito: boolean; feitoEm: string | null; feitoPor: string | null;
  pontos: number; avaliacao: "VALIDADO" | "RE" | null; avaliadoPor: string | null; motivoRe: string | null; fotos: number;
};
type Pessoa = { id: string; nome: string; funcao: string; telefone: string; link: string; pontos: number; itens: Item[] };

export const FUNCAO: Record<string, string> = { DIARISTA: "Diarista", BARBEIRO: "Barbeiro", GERENTE: "Gerente" };
const hora = (d: string) => new Date(d).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

/** Checklist da equipe: o dia de cada pessoa + cadastro de tarefas, pessoas e horarios de envio. */
export function ChecklistTela() {
  const [aba, setAba] = useState<"hoje" | "classificacao" | "cadastro">("hoje");
  const [data, setData] = useState<string | null>(null);
  const [pessoas, setPessoas] = useState<Pessoa[] | null>(null);
  const [pontosRe, setPontosRe] = useState(20);
  const [msg, setMsg] = useState<{ t: string; erro?: boolean } | null>(null);

  const carregar = useCallback((d?: string | null) => {
    api<{ data: string; pessoas: Pessoa[]; pontosRe: number }>(`/api/checklist/itens${d ? `?data=${d}` : ""}`)
      .then((r) => { setData(r.data); setPessoas(r.pessoas); setPontosRe(r.pontosRe); })
      .catch((e) => setMsg({ t: e.message, erro: true }));
  }, []);

  async function avaliar(i: Item, nome: string, avaliacao: "VALIDADO" | "RE" | null) {
    let motivo: string | null = null;
    if (avaliacao === "RE") {
      const r = prompt(`Dar ré em "${i.titulo}" (${nome})? Ela perde ${pontosRe} pts e a tarefa volta para não feita.\nMotivo (opcional):`, "");
      if (r === null) return;
      motivo = r.trim() || null;
    }
    setMsg(null);
    try {
      await api("/api/checklist/avaliar", { method: "POST", body: { itemId: i.id, avaliacao, motivo } });
      if (avaliacao === "RE") setMsg({ t: `Ré registrada. ${nome.split(" ")[0]} foi avisado(a) no WhatsApp.` });
    } catch (e) {
      setMsg({ t: (e as Error).message, erro: true });
    }
    carregar(data);
  }
  useEffect(() => { carregar(); }, [carregar]);

  async function marcar(itemId: string, feito: boolean) {
    setPessoas((ps) => ps?.map((p) => ({ ...p, itens: p.itens.map((i) => (i.id === itemId ? { ...i, feito } : i)) })) ?? null);
    try {
      await api("/api/checklist/itens", { method: "PATCH", body: { itemId, feito } });
      carregar(data);
    } catch (e) {
      setMsg({ t: (e as Error).message, erro: true });
      carregar(data);
    }
  }

  async function enviar(body: Record<string, unknown>, ok: string) {
    setMsg(null);
    try {
      await api("/api/checklist/enviar", { method: "POST", body });
      setMsg({ t: ok });
    } catch (e) {
      setMsg({ t: (e as Error).message, erro: true });
    }
  }

  const total = pessoas?.reduce((t, p) => t + p.itens.length, 0) ?? 0;
  const feitas = pessoas?.reduce((t, p) => t + p.itens.filter((i) => i.feito).length, 0) ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Equipe</p>
          <h1 className="titulo-marca text-2xl">Checklist</h1>
          {aba === "hoje" && total > 0 && <p className="text-sm text-zinc-500">{feitas} de {total} tarefas feitas</p>}
        </div>
        <div className="flex gap-2">
          <button className={aba === "hoje" ? "btn-primario" : "btn"} onClick={() => setAba("hoje")}>Dia</button>
          <button className={aba === "classificacao" ? "btn-primario" : "btn"} onClick={() => setAba("classificacao")}>Classificação</button>
          <button className={aba === "cadastro" ? "btn-primario" : "btn"} onClick={() => setAba("cadastro")}>Tarefas e pessoas</button>
        </div>
      </div>
      {msg && <p className={`rounded-xl p-3 text-sm ${msg.erro ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"}`}>{msg.t}</p>}

      {aba === "classificacao" ? <ChecklistClassificacao /> : aba === "cadastro" ? <ChecklistCadastro aoSalvar={() => carregar(data)} /> : (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <div><label className="rotulo">Dia</label><input type="date" className="campo" value={data ?? ""} onChange={(e) => carregar(e.target.value)} /></div>
            <button className="btn" onClick={() => enviar({ acao: "resumo" }, "Resumo enviado no WhatsApp do gerente.")}><Send size={15} /> Mandar resumo agora</button>
          </div>
          {pessoas && pessoas.length === 0 && (
            <div className="cartao text-sm text-zinc-500">Ninguém cadastrado ainda. Vá em <b>Tarefas e pessoas</b> e cadastre a diarista, os barbeiros e o gerente com o WhatsApp de cada um.</div>
          )}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {pessoas?.map((p) => {
              const ok = p.itens.filter((i) => i.feito).length;
              return (
                <section key={p.id} className="cartao space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h2 className="font-semibold">{p.nome}</h2>
                      <p className="text-xs text-zinc-500">{FUNCAO[p.funcao]} · {ok}/{p.itens.length} · <b className="text-ouro">{p.pontos} pts</b></p>
                    </div>
                    <div className="flex gap-1">
                      <button className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100" title="Copiar link da pessoa" onClick={() => navigator.clipboard.writeText(p.link).then(() => setMsg({ t: `Link de ${p.nome} copiado.` }))}><Copy size={15} /></button>
                      <button className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100" title="Mandar a lista no WhatsApp agora" onClick={() => enviar({ acao: "lista", pessoaId: p.id }, `Lista enviada para ${p.nome}.`)}><Send size={15} /></button>
                    </div>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-zinc-200"><div className="h-full bg-ouro transition-all" style={{ width: `${p.itens.length ? (ok / p.itens.length) * 100 : 0}%` }} /></div>
                  {p.itens.length === 0 ? <p className="text-xs text-zinc-500">Sem tarefas nesse dia.</p> : (
                    <ul className="space-y-1">
                      {p.itens.map((i) => (
                        <li key={i.id} className="rounded-lg hover:bg-zinc-100">
                          <button onClick={() => marcar(i.id, !i.feito)} className="flex w-full items-start gap-2 px-1.5 py-1 text-left text-sm">
                            {i.feito ? <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-emerald-600" /> : <Circle size={17} className="mt-0.5 shrink-0 text-zinc-400" />}
                            <span className={`flex-1 ${i.feito ? "text-zinc-500 line-through" : ""}`}>
                              {i.horario && <span className="mr-1 text-xs font-semibold text-ouro">{i.horario}</span>}{i.titulo}
                              {i.feito && i.feitoEm && <span className="block text-[11px] text-zinc-500 no-underline">{hora(i.feitoEm)}{i.feitoPor && i.feitoPor !== "link" ? ` · marcado por ${i.feitoPor}` : ""}</span>}
                            </span>
                          </button>
                          <Avaliacao i={i} pontosRe={pontosRe} aoAvaliar={(a) => avaliar(i, p.nome, a)} />
                          <FotosTarefa itemId={i.id} quantidade={i.fotos} validada={i.avaliacao === "VALIDADO"} />
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/** Selo e botoes de avaliacao do gerente (Validar +N / Re -N). */
function Avaliacao({ i, pontosRe, aoAvaliar }: { i: Item; pontosRe: number; aoAvaliar: (a: "VALIDADO" | "RE" | null) => void }) {
  if (i.avaliacao === "VALIDADO") {
    return (
      <div className="flex items-center gap-2 pb-1 pl-7 text-[11px]">
        <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-bold text-emerald-700">VALIDADO +{i.pontos}</span>
        {i.avaliadoPor && <span className="text-zinc-500">por {i.avaliadoPor}</span>}
        <button className="ml-auto inline-flex items-center gap-0.5 text-zinc-500 hover:text-red-600" title="Trocar para ré" onClick={() => aoAvaliar("RE")}><ThumbsDown size={12} /> Ré</button>
        <button className="inline-flex items-center gap-0.5 text-zinc-500 hover:text-zinc-900" title="Desfazer validação" onClick={() => aoAvaliar(null)}><Undo2 size={12} /></button>
      </div>
    );
  }
  if (i.avaliacao === "RE") {
    return (
      <div className="flex items-center gap-2 pb-1 pl-7 text-[11px]">
        <span className="rounded-full bg-red-50 px-2 py-0.5 font-bold text-red-700">RÉ −{pontosRe}</span>
        <span className="flex-1 text-zinc-500">{i.motivoRe ?? "marcou sem fazer"}{i.avaliadoPor ? ` · ${i.avaliadoPor}` : ""}</span>
        <button className="inline-flex items-center gap-0.5 text-zinc-500 hover:text-zinc-900" title="Desfazer a ré (devolve os pontos)" onClick={() => aoAvaliar(null)}><Undo2 size={12} /></button>
      </div>
    );
  }
  if (!i.feito) return null;
  return (
    <div className="flex items-center gap-1.5 pb-1.5 pl-7 text-[11px]">
      <span className="mr-auto text-amber-700">Aguardando validação</span>
      <button className="inline-flex items-center gap-1 rounded-full border border-emerald-600 px-2 py-0.5 font-bold text-emerald-700 hover:bg-emerald-50" onClick={() => aoAvaliar("VALIDADO")}><ThumbsUp size={12} /> Validar +{i.pontos}</button>
      <button className="inline-flex items-center gap-1 rounded-full border border-red-500 px-2 py-0.5 font-bold text-red-600 hover:bg-red-50" onClick={() => aoAvaliar("RE")}><ThumbsDown size={12} /> Ré −{pontosRe}</button>
    </div>
  );
}
