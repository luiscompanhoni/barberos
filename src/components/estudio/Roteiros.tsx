"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/cliente-api";
import type { OpcaoRoteiro, Roteiro } from "@/lib/estudio/roteiro-tipos";
import type { Preset } from "@/lib/estudio/templates";

export function ImportarRoteiro({ preset, ocupado, executar, abrir, inicial }: {
  preset: Preset; ocupado: boolean; inicial?: string;
  executar: (fn: () => Promise<unknown>) => Promise<void>; abrir: (id: string) => void;
}) {
  const [roteiros, setRoteiros] = useState<OpcaoRoteiro[] | null>(null);
  const [selecionado, setSelecionado] = useState(inicial ?? "");
  const [erro, setErro] = useState("");
  const [consulta, setConsulta] = useState(0);
  useEffect(() => {
    let cancelado = false;
    void api<{ roteiros: OpcaoRoteiro[] }>("/api/estudio/roteiros" + (inicial ? `?execucaoId=${encodeURIComponent(inicial)}` : "")).then(d => { if (!cancelado) { setRoteiros(d.roteiros); setErro(""); } }).catch(e => { if (!cancelado) setErro(e instanceof Error ? e.message : "Não foi possível consultar os roteiros."); });
    return () => { cancelado = true; };
  }, [consulta, inicial]);
  const r = roteiros?.find(r => r.id === selecionado);
  return <section className="cartao space-y-3" aria-labelledby="roteiros-titulo">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 id="roteiros-titulo" className="font-semibold">Começar com um roteiro da Central</h2><button className="btn text-xs" disabled={ocupado} onClick={() => setConsulta(n => n + 1)}>Atualizar roteiros</button></div>
    <p className="text-sm text-zinc-500">Importe um roteiro aprovado do agente de conteúdo. A origem fica registrada; o vídeo terá sua própria revisão e aprovação.</p>
    {erro ? <p role="alert" className="text-sm text-red-500">{erro}</p> : !roteiros ? <p role="status" className="text-sm">Consultando roteiros…</p> : !roteiros.length ? <p className="text-sm">Ainda não há roteiros seus aprovados. <Link href="/agentes" className="text-ouro underline">Abrir a Central de Agentes</Link></p> : <>
      <label className="block text-sm">Roteiro aprovado<select className="campo mt-1 w-full" value={selecionado} disabled={ocupado} onChange={e => setSelecionado(e.target.value)}><option value="">Selecione um roteiro</option>{roteiros.map(r => <option value={r.id} key={r.id}>{r.tarefa.slice(0, 100)}</option>)}</select></label>
      {inicial && !roteiros.some(r => r.id === inicial) ? <p className="text-xs text-amber-600">O roteiro do atalho não está disponível ou não foi aprovado para este usuário.</p> : null}
      {r ? <p className="whitespace-pre-wrap break-words text-sm text-zinc-500">{r.tarefa}</p> : null}
      <button className="btn" disabled={ocupado || !r} onClick={() => void executar(async () => {
        if (!r) return;
        const p = await api<{ id: string; reutilizado: boolean }>("/api/estudio/roteiros", { method: "POST", body: { execucaoId: r.id, revisao: r.revisao, resultadoHash: r.resultadoHash, nome: r.tarefa.slice(0, 80), preset } });
        abrir(p.id);
      })}>Abrir roteiro no Estúdio</button>
      <p className="text-xs text-zinc-500">Usa o template escolhido acima. Se já foi importado, abre o mesmo projeto preservando sua montagem.</p>
    </>}
  </section>;
}

export function ReferenciaRoteiro({ roteiro: r }: { roteiro: Roteiro }) {
  return <details className="cartao space-y-3" open>
    <summary className="cursor-pointer font-semibold">Roteiro aprovado · Central de Agentes</summary>
    <p className="text-xs text-zinc-500">Use esta referência para escolher os clipes e adaptar os textos de cada cena. A importação não gera imagens, voz ou vídeos por IA.</p>
    <p className="whitespace-pre-wrap break-words text-sm">{r.resumo}</p>
    <ol className="list-decimal space-y-3 pl-5 text-sm">{r.entregaveis.map((t, i) => <li className="whitespace-pre-wrap break-words" key={i}>{t}</li>)}</ol>
    {r.alertas.length ? <div className="rounded-lg border border-amber-300/40 p-3 text-sm"><p className="font-semibold">Pontos de atenção do roteiro</p><ul className="mt-2 list-disc space-y-2 pl-4">{r.alertas.map((t, i) => <li className="whitespace-pre-wrap break-words" key={i}>{t}</li>)}</ul></div> : null}
    <p className="break-all text-xs text-zinc-500">Origem {r.execucaoId} · revisão {r.revisao} · aprovado em {new Date(r.aprovadoEm).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}<br />SHA-256: {r.resultadoHash}</p>
  </details>;
}
