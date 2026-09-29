"use client";

import { useState } from "react";
import { api } from "@/lib/cliente-api";
import { hhmmParaMin, minParaHhmm } from "@/lib/agenda/tempo";
import { ListaAfetados, type Afetado } from "./ListaAfetados";

export type ExcecaoApi = {
  id: string;
  data: string;
  tipo: "FOLGA" | "HORARIO_ESPECIAL";
  intervalos: { inicioMin: number; fimMin: number }[] | null;
  motivo: string | null;
};

const dataBonita = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", timeZone: "UTC" });

/** Folga avulsa, dia extra ou horario diferente numa data. */
export function Excecoes(p: { barbeiroId: string; excecoes: ExcecaoApi[]; hoje: string; onSalvo: () => void }) {
  const [data, setData] = useState("");
  const [tipo, setTipo] = useState<"FOLGA" | "HORARIO_ESPECIAL">("FOLGA");
  const [inicio, setInicio] = useState("09:00");
  const [fim, setFim] = useState("13:00");
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState("");
  const [afetados, setAfetados] = useState<Afetado[]>([]);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    if (!data) return setErro("Escolha a data.");
    if (data < p.hoje) return setErro("Escolha uma data de hoje em diante.");
    try {
      const intervalos = tipo === "HORARIO_ESPECIAL" ? [{ inicioMin: hhmmParaMin(inicio), fimMin: hhmmParaMin(fim) }] : undefined;
      if (intervalos && intervalos[0].fimMin <= intervalos[0].inicioMin) return setErro("O fim precisa ser depois do início.");
      const r = await api<{ afetados: Afetado[] }>(`/api/barbeiros/${p.barbeiroId}/excecoes`, {
        method: "POST",
        body: { data, tipo, intervalos, motivo: motivo.trim() || undefined },
      });
      setAfetados(r.afetados);
      setData(""); setMotivo("");
      p.onSalvo();
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  async function remover(d: string) {
    const r = await api<{ afetados: Afetado[] }>(`/api/barbeiros/${p.barbeiroId}/excecoes?data=${d}`, { method: "DELETE" });
    setAfetados(r.afetados);
    p.onSalvo();
  }

  return (
    <section className="cartao space-y-3">
      <div>
        <h2 className="font-semibold">Folga, dia extra ou horário diferente</h2>
        <p className="text-sm text-zinc-500">Vale só para a data escolhida e substitui a semana padrão naquele dia.</p>
      </div>
      <form onSubmit={salvar} className="grid gap-2 sm:grid-cols-[auto_auto_1fr_auto] sm:items-end">
        <div>
          <label className="rotulo">Data</label>
          <input type="date" className="campo" min={p.hoje} value={data} onChange={(e) => setData(e.target.value)} />
        </div>
        <div>
          <label className="rotulo">O que muda</label>
          <select className="campo" value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)}>
            <option value="FOLGA">Folga (não trabalho)</option>
            <option value="HORARIO_ESPECIAL">Horário diferente / dia extra</option>
          </select>
        </div>
        <div className="flex items-end gap-2">
          {tipo === "HORARIO_ESPECIAL" && (
            <div className="flex items-center gap-1">
              <input type="time" step={900} className="campo w-28" value={inicio} onChange={(e) => setInicio(e.target.value)} />
              <span className="text-sm">às</span>
              <input type="time" step={900} className="campo w-28" value={fim} onChange={(e) => setFim(e.target.value)} />
            </div>
          )}
          <input className="campo" placeholder="Motivo (opcional)" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        </div>
        <button className="btn-primario">Salvar</button>
      </form>
      {erro && <p className="text-sm text-red-600">{erro}</p>}
      <ListaAfetados afetados={afetados} />

      {p.excecoes.length > 0 && (
        <ul className="divide-y divide-zinc-100 text-sm">
          {p.excecoes.map((e) => (
            <li key={e.id} className="flex items-center gap-2 py-2">
              <span className="w-56 capitalize">{dataBonita(e.data)}</span>
              <span className={e.tipo === "FOLGA" ? "text-red-700" : "text-emerald-700"}>
                {e.tipo === "FOLGA" ? "Folga" : (e.intervalos ?? []).map((i) => `${minParaHhmm(i.inicioMin)}-${minParaHhmm(i.fimMin)}`).join(", ")}
              </span>
              {e.motivo && <span className="text-zinc-500">· {e.motivo}</span>}
              <button className="ml-auto text-xs text-zinc-500 underline" onClick={() => remover(e.data)}>desfazer</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
