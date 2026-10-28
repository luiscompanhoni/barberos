"use client";

import { useState } from "react";
import type { Notas } from "@/lib/desempenho/schemas";
import type { Acao } from "./tipos";

const CAMPOS: { chave: keyof Notas; titulo: string }[] = [
  { chave: "execucao", titulo: "Execução das funções" }, { chave: "organizacao", titulo: "Organização e checklist" },
  { chave: "atendimento", titulo: "Qualidade do atendimento" }, { chave: "colaboracao", titulo: "Colaboração" },
];

export function AvaliacaoLiderForm(p: { pessoaId: string; hoje: string; acao: Acao; salvando: boolean }) {
  const [tipo, setTipo] = useState("DIARIA"), [data, setData] = useState(p.hoje), [comentario, setComentario] = useState("");
  const [notas, setNotas] = useState<Record<keyof Notas, string>>({ execucao: "", organizacao: "", atendimento: "", colaboracao: "" });
  return <form className="cartao space-y-3" onSubmit={async (e) => {
    e.preventDefault();
    if (await p.acao({ acao: "avaliar", pessoaId: p.pessoaId, tipo, data, notas: Object.fromEntries(Object.entries(notas).map(([k, v]) => [k, Number(v)])), comentario })) setComentario("");
  }}><h2 className="font-semibold">Avaliação da liderança</h2><p className="text-sm text-zinc-500">Dê uma nota de 1 a 5 em cada critério. Notas 1 ou 2 precisam de justificativa. Salvar novamente a mesma data e tipo revisa a avaliação com histórico.</p>
    <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Período<select className="campo mt-1" value={tipo} onChange={(e) => setTipo(e.target.value)}><option value="DIARIA">Diária</option><option value="SEMANAL">Fechamento semanal</option></select></label><label className="text-sm">Data<input required type="date" className="campo mt-1" max={p.hoje} value={data} onChange={(e) => setData(e.target.value)} /></label></div>
    <div className="grid gap-3 sm:grid-cols-2">{CAMPOS.map((c) => <label className="text-sm" key={c.chave}>{c.titulo}<select required className="campo mt-1" value={notas[c.chave]} onChange={(e) => setNotas({ ...notas, [c.chave]: e.target.value })}><option value="">Escolha a nota</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} / 5</option>)}</select></label>)}</div>
    <label className="block text-sm">Orientação para evolução<textarea className="campo mt-1" maxLength={1000} value={comentario} onChange={(e) => setComentario(e.target.value)} /></label><button className="btn-primario" disabled={p.salvando}>Salvar avaliação</button>
  </form>;
}
