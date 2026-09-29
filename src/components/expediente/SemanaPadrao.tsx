"use client";

import { useState } from "react";
import { api } from "@/lib/cliente-api";
import { hhmmParaMin, minParaHhmm } from "@/lib/agenda/tempo";
import { ListaAfetados, type Afetado } from "./ListaAfetados";

type Linha = { diaSemana: number; inicioMin: number; fimMin: number };
const DIAS = [
  [1, "Segunda"], [2, "Terça"], [3, "Quarta"], [4, "Quinta"], [5, "Sexta"], [6, "Sábado"], [0, "Domingo"],
] as const;

export function SemanaPadrao(p: { barbeiroId: string; inicial: Linha[]; onSalvo: () => void }) {
  const [linhas, setLinhas] = useState<Linha[]>(p.inicial);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");
  const [afetados, setAfetados] = useState<Afetado[]>([]);
  const [salvando, setSalvando] = useState(false);

  const doDia = (d: number) => linhas.map((l, i) => ({ ...l, i })).filter((l) => l.diaSemana === d);
  const atualizar = (i: number, campo: "inicioMin" | "fimMin", valor: string) => {
    try {
      const min = hhmmParaMin(valor);
      setLinhas((ls) => ls.map((l, k) => (k === i ? { ...l, [campo]: min } : l)));
    } catch {}
  };
  const alternarDia = (d: number) =>
    setLinhas((ls) =>
      doDia(d).length
        ? ls.filter((l) => l.diaSemana !== d)
        : [...ls, { diaSemana: d, inicioMin: 540, fimMin: 720 }, { diaSemana: d, inicioMin: 780, fimMin: 1140 }],
    );
  // Aplica os horarios deste dia aos outros dias em que o barbeiro ja trabalha.
  const copiarParaTodos = (d: number) =>
    setLinhas((ls) => {
      const modelo = ls.filter((l) => l.diaSemana === d);
      const outros = [...new Set(ls.map((l) => l.diaSemana))].filter((x) => x !== d);
      return [...modelo, ...outros.flatMap((x) => modelo.map((m) => ({ ...m, diaSemana: x })))];
    });

  async function salvar() {
    setErro(""); setOk(""); setSalvando(true);
    try {
      const r = await api<{ afetados: Afetado[] }>(`/api/barbeiros/${p.barbeiroId}/agenda`, { method: "PUT", body: { expediente: linhas } });
      setAfetados(r.afetados);
      setOk("Semana salva. O bot e o site já usam os novos horários.");
      p.onSalvo();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <section className="cartao space-y-3">
      <div>
        <h2 className="font-semibold">Semana padrão</h2>
        <p className="text-sm text-zinc-500">Dias e horários que se repetem toda semana. Use dois horários no mesmo dia para marcar o almoço.</p>
      </div>
      <div className="divide-y divide-zinc-100">
        {DIAS.map(([d, nome]) => {
          const ints = doDia(d);
          return (
            <div key={d} className="flex flex-wrap items-center gap-2 py-2">
              <label className="flex w-28 items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={ints.length > 0} onChange={() => alternarDia(d)} className="h-4 w-4" />
                {nome}
              </label>
              {ints.length === 0 && <span className="text-sm text-zinc-400">Folga</span>}
              {ints.map((l) => (
                <span key={l.i} className="flex items-center gap-1 rounded-lg bg-zinc-50 px-2 py-1 text-sm">
                  <input type="time" step={900} className="rounded border border-zinc-300 px-1" value={minParaHhmm(l.inicioMin)} onChange={(e) => atualizar(l.i, "inicioMin", e.target.value)} />
                  <span>às</span>
                  <input type="time" step={900} className="rounded border border-zinc-300 px-1" value={minParaHhmm(l.fimMin)} onChange={(e) => atualizar(l.i, "fimMin", e.target.value)} />
                  <button className="px-1 text-zinc-400 hover:text-red-600" aria-label="Remover horário" onClick={() => setLinhas((ls) => ls.filter((_, k) => k !== l.i))}>✕</button>
                </span>
              ))}
              {ints.length > 0 && (
                <>
                  <button className="text-xs text-zinc-600 underline" onClick={() => setLinhas((ls) => [...ls, { diaSemana: d, inicioMin: ints[ints.length - 1].fimMin, fimMin: Math.min(1440, ints[ints.length - 1].fimMin + 60) }])}>+ horário</button>
                  <button className="text-xs text-zinc-600 underline" onClick={() => copiarParaTodos(d)}>copiar para os outros dias de trabalho</button>
                </>
              )}
            </div>
          );
        })}
      </div>
      {erro && <p className="text-sm text-red-600">{erro}</p>}
      {ok && <p className="text-sm text-emerald-700">{ok}</p>}
      <ListaAfetados afetados={afetados} />
      <button className="btn-primario" onClick={salvar} disabled={salvando}>{salvando ? "Salvando..." : "Salvar semana"}</button>
    </section>
  );
}
