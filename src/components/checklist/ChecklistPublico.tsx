"use client";

import { useState } from "react";
import { CheckCircle2, Circle } from "lucide-react";
import { ProgressoNivel, SeloNivel, type Nivel } from "./SeloNivel";
import { FotosTarefa } from "./FotosTarefa";

type Item = { id: string; titulo: string; horario: string | null; feito: boolean; pontos: number; avaliacao: "VALIDADO" | "RE" | null; motivoRe: string | null; fotos: number };
type Pontos = { pontos: number; nivel: Nivel; proximo: Nivel | null; faltam: number; percentual: number };

function Status({ i }: { i: Item }) {
  if (i.avaliacao === "VALIDADO") return <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">Validada +{i.pontos}</span>;
  if (i.avaliacao === "RE") return <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-bold text-red-700">Ré 😬{i.motivoRe ? ` · ${i.motivoRe}` : ""}</span>;
  if (i.feito) return <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700">Aguardando validação</span>;
  return <span className="text-[11px] text-zinc-500">vale {i.pontos} pts</span>;
}

/** Lista do dia aberta pelo link do WhatsApp (sem login), com os pontos e a faixa da pessoa. */
export function ChecklistPublico({ token, nome, data, itens: inicial, pontos }: { token: string; nome: string; data: string; itens: Item[]; pontos: Pontos }) {
  const [itens, setItens] = useState(inicial);
  const [erro, setErro] = useState("");
  const feitas = itens.filter((i) => i.feito).length;

  async function marcar(i: Item, feito: boolean) {
    if (i.avaliacao === "VALIDADO") return setErro("Essa tarefa já foi validada pelo gerente.");
    setErro("");
    // Marcar de novo depois de uma re volta para "aguardando validacao".
    setItens((xs) => xs.map((x) => (x.id === i.id ? { ...x, feito, avaliacao: null, motivoRe: null } : x)));
    const r = await fetch(`/api/checklist/t/${token}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ itemId: i.id, feito }) }).catch(() => null);
    if (!r?.ok) {
      setItens((xs) => xs.map((x) => (x.id === i.id ? i : x)));
      setErro("Não consegui salvar. Confira a internet e tente de novo.");
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="eyebrow">{data.split("-").reverse().join("/")}</p>
        <h1 className="titulo-marca mt-2 text-3xl">Oi, <span className="text-ouro">{nome.split(" ")[0]}.</span></h1>
        <p className="mt-1 text-sm text-zinc-500">{itens.length ? `${feitas} de ${itens.length} feitas${feitas === itens.length ? " — tudo pronto! 🎉" : ""}` : "Sem tarefas para hoje."}</p>
      </div>
      <div className="cartao space-y-2">
        <div className="flex items-center justify-between gap-2">
          <SeloNivel nivel={pontos.nivel} />
          <p className="text-2xl font-black tabular-nums">{pontos.pontos}<span className="ml-1 text-xs font-semibold text-zinc-500">pts</span></p>
        </div>
        <ProgressoNivel percentual={pontos.percentual} proximo={pontos.proximo} faltam={pontos.faltam} />
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-zinc-200"><div className="h-full bg-ouro transition-all" style={{ width: `${itens.length ? (feitas / itens.length) * 100 : 0}%` }} /></div>
      <ul className="space-y-2">
        {itens.map((i) => (
          <li key={i.id}>
            <button onClick={() => marcar(i, !i.feito)} className={`cartao flex w-full items-center gap-3 p-4 text-left ${i.feito ? "opacity-70" : ""}`}>
              {i.feito ? <CheckCircle2 size={26} className="shrink-0 text-emerald-600" /> : <Circle size={26} className="shrink-0 text-zinc-400" />}
              <span className="flex-1">
                <span className={`block text-base ${i.feito ? "line-through" : "font-semibold"}`}>
                  {i.horario && <span className="mr-1.5 text-sm font-bold text-ouro">{i.horario}</span>}{i.titulo}
                </span>
                <Status i={i} />
              </span>
            </button>
            <FotosTarefa itemId={i.id} token={token} quantidade={i.fotos} validada={i.avaliacao === "VALIDADO"} />
          </li>
        ))}
      </ul>
      {erro && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{erro}</p>}
      <p className="text-center text-xs text-zinc-500">Toque na tarefa para marcar como feita. O gerente confere e valida: cada tarefa validada soma pontos; marcar sem fazer dá ré e tira pontos.</p>
    </div>
  );
}
