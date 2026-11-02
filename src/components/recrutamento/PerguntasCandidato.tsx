"use client";
import { useId } from "react";
import { perguntasVisiveis, type Pergunta, type Respostas } from "@/lib/recrutamento/formularios-regras";
export function PerguntasCandidato({ perguntas, respostas, alterar }: { perguntas: Pergunta[]; respostas: Respostas; alterar: (r: Respostas) => void }) {
  const prefixo = useId();
  function mudar(id: string, valor: string | string[]) {
    const novas = { ...respostas, [id]: valor }; const ativas = new Set(perguntasVisiveis(perguntas, novas).map(p => p.id));
    alterar(Object.fromEntries(Object.entries(novas).filter(([k]) => ativas.has(k))));
  }
  return <section className="space-y-5"><h2 className="text-xl font-semibold">Sua experiência profissional</h2><p className="text-sm text-zinc-500">Queremos conhecer como você trabalha. Responda com suas palavras. Se ainda não fez uma atividade, pode informar. A equipe analisa as respostas; o cadastro não garante entrevista ou contratação.</p>
    {perguntasVisiveis(perguntas, respostas).map(p => <fieldset key={p.id} className="space-y-2"><legend className="font-medium">{p.texto} {p.obrigatoria ? "(obrigatória)" : "(opcional)"}</legend><p className="text-sm text-zinc-500" id={`${prefixo}-ajuda-${p.id}`}>{p.instrucao}</p>
      {p.tipo === "MULTIPLA" ? p.opcoes.map((op, indice) => <label className="flex min-h-11 items-center gap-2" key={op}><input type="checkbox" aria-describedby={`${prefixo}-ajuda-${p.id}`} required={indice === 0 && p.obrigatoria && (!Array.isArray(respostas[p.id]) || !respostas[p.id].length)} checked={Array.isArray(respostas[p.id]) && respostas[p.id].includes(op)} onChange={e => { const a = Array.isArray(respostas[p.id]) ? respostas[p.id] as string[] : []; mudar(p.id, e.target.checked ? [...a, op] : a.filter(v => v !== op)); }} />{op}</label>) : p.tipo === "UNICA" ? <select aria-label={p.texto} aria-describedby={`${prefixo}-ajuda-${p.id}`} className="campo" required={p.obrigatoria} value={String(respostas[p.id] ?? "")} onChange={e => mudar(p.id, e.target.value)}><option value="">Selecione</option>{p.opcoes.map(op => <option key={op}>{op}</option>)}</select> : p.tipo === "LONGO" ? <textarea aria-label={p.texto} aria-describedby={`${prefixo}-ajuda-${p.id}`} className="campo" rows={3} required={p.obrigatoria} maxLength={3000} value={String(respostas[p.id] ?? "")} onChange={e => mudar(p.id, e.target.value)} /> : <input aria-label={p.texto} aria-describedby={`${prefixo}-ajuda-${p.id}`} className="campo" type={p.tipo === "LINK" ? "url" : "text"} required={p.obrigatoria} maxLength={p.tipo === "CURTO" ? 300 : 3000} value={String(respostas[p.id] ?? "")} onChange={e => mudar(p.id, e.target.value)} />}
    </fieldset>)}
  </section>;
}
