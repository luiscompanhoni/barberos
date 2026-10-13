"use client";

import { useEffect, useState } from "react";
import { Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { api } from "@/lib/cliente-api";

type Funcao = "DIARISTA" | "BARBEIRO" | "GERENTE";
type Pessoa = { id?: string; chave: string; nome: string; telefone: string; funcao: Funcao; ativo: boolean; link?: string };
type Tarefa = { id?: string; chave: string; titulo: string; funcao: Funcao; diasSemana: number[]; horario: string; ativo: boolean; pontos: number };
type Dados = {
  config: { ativo: boolean; horaEnvio: string; horaResumo: string; pontosRe: number; nivelPlatina: number; nivelLegend: number };
  pessoas: (Omit<Pessoa, "chave"> & { id: string; link: string })[];
  tarefas: (Omit<Tarefa, "chave" | "horario"> & { id: string; horario: string | null })[];
};

const FUNCOES: { v: Funcao; r: string }[] = [{ v: "DIARISTA", r: "Diarista" }, { v: "BARBEIRO", r: "Barbeiros" }, { v: "GERENTE", r: "Gerente" }];
const DIAS = ["D", "S", "T", "Q", "Q", "S", "S"];
const telVisivel = (t: string) => t.replace(/^55/, "").replace(/^(\d{2})(\d{5})(\d{4})$/, "($1) $2-$3");
let seq = 0;

/** Cadastro do checklist: horarios do WhatsApp, pessoas (com o link de cada uma) e tarefas por funcao. */
export function ChecklistCadastro({ aoSalvar }: { aoSalvar: () => void }) {
  const [cfg, setCfg] = useState<Dados["config"] | null>(null);
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [tarefas, setTarefas] = useState<Tarefa[]>([]);
  const [funcao, setFuncao] = useState<Funcao>("DIARISTA");
  const [msg, setMsg] = useState<{ t: string; erro?: boolean } | null>(null);
  const [salvando, setSalvando] = useState(false);

  function aplicar(d: Dados) {
    setCfg(d.config);
    setPessoas(d.pessoas.map((p) => ({ ...p, chave: p.id, telefone: telVisivel(p.telefone) })));
    setTarefas(d.tarefas.map((t) => ({ ...t, chave: t.id, horario: t.horario ?? "" })));
  }
  useEffect(() => { api<Dados>("/api/checklist").then(aplicar).catch((e) => setMsg({ t: e.message, erro: true })); }, []);

  async function salvar() {
    if (!cfg) return;
    setMsg(null);
    setSalvando(true);
    try {
      const d = await api<Dados>("/api/checklist", {
        method: "PUT",
        body: {
          config: cfg,
          pessoas: pessoas.map(({ id, nome, telefone, funcao: f, ativo }) => ({ ...(id ? { id } : {}), nome, telefone, funcao: f, ativo })),
          tarefas: tarefas.map(({ id, titulo, funcao: f, diasSemana, horario, ativo, pontos }) => ({ ...(id ? { id } : {}), titulo, funcao: f, diasSemana, horario: horario || null, ativo, pontos })),
        },
      });
      aplicar(d);
      aoSalvar();
      setMsg({ t: "Checklist salvo." });
    } catch (e) {
      setMsg({ t: (e as Error).message, erro: true });
    } finally {
      setSalvando(false);
    }
  }

  async function novoLink(id: string) {
    if (!confirm("Gerar um link novo? O link antigo para de funcionar.")) return;
    await api("/api/checklist/enviar", { method: "POST", body: { acao: "novo_link", pessoaId: id } }).catch(() => {});
    aplicar(await api<Dados>("/api/checklist"));
  }

  if (!cfg) return <div className="cartao text-sm text-zinc-500">{msg?.t ?? "Carregando…"}</div>;
  const muda = <T extends { chave: string }>(set: React.Dispatch<React.SetStateAction<T[]>>, chave: string, d: Partial<T>) =>
    set((xs) => xs.map((x) => (x.chave === chave ? { ...x, ...d } : x)));
  const daFuncao = tarefas.filter((t) => t.funcao === funcao);

  return (
    <div className="space-y-4">
      {msg && <p className={`rounded-xl p-3 text-sm ${msg.erro ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"}`}>{msg.t}</p>}

      <section className="cartao space-y-3">
        <label className="flex items-center gap-3 font-semibold">
          <input type="checkbox" className="h-5 w-5 accent-[#d3ab45]" checked={cfg.ativo} onChange={(e) => setCfg({ ...cfg, ativo: e.target.checked })} />
          Mandar o checklist pelo WhatsApp todo dia
        </label>
        <div className="flex flex-wrap gap-3">
          <div><label className="rotulo">Lista do dia às</label><input type="time" className="campo" value={cfg.horaEnvio} onChange={(e) => setCfg({ ...cfg, horaEnvio: e.target.value })} /></div>
          <div><label className="rotulo">Resumo de pendências às</label><input type="time" className="campo" value={cfg.horaResumo} onChange={(e) => setCfg({ ...cfg, horaResumo: e.target.value })} /></div>
        </div>
        <p className="text-xs text-zinc-500">Cada pessoa recebe a lista dela com um link para marcar o que fez (não precisa de login). O resumo vai para quem é Gerente aqui (ou para o dono, se não tiver gerente).</p>
      </section>

      <section className="cartao space-y-3">
        <h2 className="font-semibold">Pontuação e faixas</h2>
        <div className="flex flex-wrap gap-3">
          {([
            ["pontosRe", "Pontos perdidos na ré"],
            ["nivelPlatina", "BLACK PLATINA a partir de"],
            ["nivelLegend", "BLACK LEGEND a partir de"],
          ] as const).map(([k, r]) => (
            <div key={k}><label className="rotulo">{r}</label><input className="campo w-36" inputMode="numeric" value={cfg[k]} onChange={(e) => setCfg({ ...cfg, [k]: Number(e.target.value.replace(/\D/g, "")) || 0 })} /></div>
          ))}
        </div>
        <p className="text-xs text-zinc-500">Todo mundo começa como BLACK ELITE. O gerente valida as tarefas feitas (ganha os pontos da tarefa) ou dá ré quando marcaram sem fazer (perde os pontos acima).</p>
      </section>

      <section className="cartao space-y-2">
        <h2 className="font-semibold">Pessoas</h2>
        {pessoas.map((p) => (
          <div key={p.chave} className={`grid items-center gap-2 rounded-xl border p-2 sm:grid-cols-[1.2fr_1fr_.9fr_auto] ${p.ativo ? "border-zinc-200" : "border-dashed border-zinc-300 opacity-60"}`}>
            <input className="campo py-1.5" placeholder="Nome" value={p.nome} onChange={(e) => muda(setPessoas, p.chave, { nome: e.target.value })} />
            <input className="campo py-1.5" placeholder="WhatsApp (47) 99999-9999" inputMode="tel" value={p.telefone} onChange={(e) => muda(setPessoas, p.chave, { telefone: e.target.value })} />
            <select className="campo py-1.5" value={p.funcao} onChange={(e) => muda(setPessoas, p.chave, { funcao: e.target.value as Funcao })}>
              {FUNCOES.map((f) => <option key={f.v} value={f.v}>{f.r.replace(/s$/, "")}</option>)}
            </select>
            <div className="flex items-center gap-1">
              <input type="checkbox" className="h-4 w-4 accent-[#d3ab45]" title="Ativo" checked={p.ativo} onChange={(e) => muda(setPessoas, p.chave, { ativo: e.target.checked })} />
              {p.id && <button className="rounded p-1 text-zinc-500 hover:bg-zinc-100" title="Gerar link novo" onClick={() => novoLink(p.id!)}><RefreshCw size={14} /></button>}
              <button className="rounded p-1 text-zinc-500 hover:bg-red-50 hover:text-red-600" title="Remover" onClick={() => setPessoas((xs) => xs.filter((x) => x.chave !== p.chave))}><Trash2 size={14} /></button>
            </div>
          </div>
        ))}
        <button className="btn" onClick={() => setPessoas((xs) => [...xs, { chave: `p${++seq}`, nome: "", telefone: "", funcao: "BARBEIRO", ativo: true }])}><Plus size={15} /> Adicionar pessoa</button>
      </section>

      <section className="cartao space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto font-semibold">Tarefas</h2>
          {FUNCOES.map((f) => <button key={f.v} className={funcao === f.v ? "btn-primario py-1.5 text-xs" : "btn py-1.5 text-xs"} onClick={() => setFuncao(f.v)}>{f.r}</button>)}
        </div>
        {daFuncao.map((t) => (
          <div key={t.chave} className={`grid items-center gap-2 rounded-xl border p-2 sm:grid-cols-[1fr_auto_auto_auto_auto] ${t.ativo ? "border-zinc-200" : "border-dashed border-zinc-300 opacity-60"}`}>
            <input className="campo py-1.5" placeholder="O que fazer" value={t.titulo} onChange={(e) => muda(setTarefas, t.chave, { titulo: e.target.value })} />
            <div className="flex gap-0.5" title="Dias (nenhum marcado = todo dia)">
              {DIAS.map((d, i) => {
                const on = t.diasSemana.includes(i);
                return (
                  <button key={i} type="button" onClick={() => muda(setTarefas, t.chave, { diasSemana: on ? t.diasSemana.filter((x) => x !== i) : [...t.diasSemana, i] })}
                    className={`h-7 w-7 rounded-full text-[11px] font-bold ${on ? "bg-ouro text-fundo" : "border border-zinc-300 text-zinc-500"}`}>{d}</button>
                );
              })}
            </div>
            <input type="time" className="campo w-28 py-1.5" title="Horário (opcional)" value={t.horario} onChange={(e) => muda(setTarefas, t.chave, { horario: e.target.value })} />
            <label className="flex items-center gap-1 text-xs text-zinc-500" title="Pontos ganhos quando o gerente valida">
              <input className="campo w-16 py-1.5 text-right" inputMode="numeric" value={t.pontos} onChange={(e) => muda(setTarefas, t.chave, { pontos: Number(e.target.value.replace(/\D/g, "")) || 0 })} /> pts
            </label>
            <div className="flex items-center gap-1">
              <input type="checkbox" className="h-4 w-4 accent-[#d3ab45]" title="Ativa" checked={t.ativo} onChange={(e) => muda(setTarefas, t.chave, { ativo: e.target.checked })} />
              <button className="rounded p-1 text-zinc-500 hover:bg-red-50 hover:text-red-600" title="Remover" onClick={() => setTarefas((xs) => xs.filter((x) => x.chave !== t.chave))}><Trash2 size={14} /></button>
            </div>
          </div>
        ))}
        <p className="text-xs text-zinc-500">Dias sem nenhum marcado = todo dia. O horário é opcional e ordena a lista.</p>
        <button className="btn" onClick={() => setTarefas((xs) => [...xs, { chave: `t${++seq}`, titulo: "", funcao, diasSemana: [], horario: "", ativo: true, pontos: 10 }])}><Plus size={15} /> Adicionar tarefa</button>
      </section>

      <button className="btn-primario" disabled={salvando} onClick={salvar}><Save size={16} /> {salvando ? "Salvando…" : "Salvar checklist"}</button>
    </div>
  );
}
