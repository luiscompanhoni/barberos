"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/cliente-api";
import { zFormulario, type Definicao, type Respostas } from "@/lib/recrutamento/formularios-regras";
import { EditorPerguntas, EditorCriterios } from "./EditorPerguntas";
import { PerguntasCandidato } from "./PerguntasCandidato";
export type FormularioGestao = { id: string; titulo: string; funcao: "BARBEIRO" | "RECEPCAO" | "AUXILIAR"; definicao: Definicao; estado: string; revisao: number; origemId: string | null };
type Modelo = Pick<FormularioGestao, "titulo" | "funcao" | "definicao">;
export function FormulariosTela({ aoAlterar }: { aoAlterar?: (sujo: boolean) => void }) {
  const [original, setOriginal] = useState("");
  const [modelos, setModelos] = useState<Modelo[]>([]);
  const [lista, setLista] = useState<FormularioGestao[]>([]); const [atual, setAtual] = useState<FormularioGestao | null>(null);
  const [erro, setErro] = useState(""); const [mensagem, setMensagem] = useState(""); const [ocupado, setOcupado] = useState(false);
  const [aba, setAba] = useState("perguntas"); const [respostas, setRespostas] = useState<Respostas>({});
  useEffect(() => { let ativo = true; api<{ formularios: FormularioGestao[]; modelos: Modelo[] }>("/api/recrutamento/formularios").then(r => { if (ativo) { setLista(r.formularios); setModelos(r.modelos); } }).catch(e => { if (ativo) setErro(e.message); }); return () => { ativo = false; }; }, []);
  function descartar() { return !atual || !mudou || confirm("Descartar as alterações não salvas deste formulário?"); }
  function selecionar(f: FormularioGestao) { if (!descartar()) return; setOriginal(JSON.stringify(f)); setAtual(structuredClone(f)); setRespostas({}); setErro(""); setMensagem(""); }
  async function executar(acao: () => Promise<unknown>, msg: string) {
    setOcupado(true); setErro(""); setMensagem("");
    try { await acao(); const r = await api<{ formularios: FormularioGestao[]; modelos: Modelo[] }>("/api/recrutamento/formularios"); setLista(r.formularios); setAtual(null); setMensagem(msg); }
    catch (e) { setErro((e as Error).message); } finally { setOcupado(false); }
  }
  function dados(f: FormularioGestao) { return { titulo: f.titulo, funcao: f.funcao, definicao: f.definicao }; }
  function salvar() {
    if (!atual) return;
    const validado = zFormulario.safeParse(dados(atual)); if (!validado.success) { setErro(validado.error.issues.map(i => i.message).join(" · ")); return; }
    void executar(() => api("/api/recrutamento/formularios", atual.id ? { method: "PATCH", body: { id: atual.id, revisao: atual.revisao, alteracao: validado.data } } : { method: "POST", body: validado.data }), "Rascunho salvo. Revise e aprove a versão antes de vinculá-la a uma vaga.");
  }
  function transicao(operacao: "APROVAR" | "ARQUIVAR") {
    if (!atual?.id) return;
    if (mudou) { setErro("Salve ou descarte as alterações antes desta ação."); return; }
    if (operacao === "APROVAR" && !confirm("Aprovar a versão salva? Ela ficará imutável. Isso não abre inscrições nem envia mensagens.")) return;
    void executar(() => api("/api/recrutamento/formularios", { method: "PATCH", body: { id: atual.id, revisao: atual.revisao, alteracao: operacao } }), operacao === "APROVAR" ? "Versão aprovada. Para editar, duplique." : "Versão arquivada.");
  }
  const mudou = !!atual && (!atual.id || JSON.stringify(atual) !== original);
  useEffect(() => { aoAlterar?.(mudou); return () => aoAlterar?.(false); }, [mudou, aoAlterar]);
  useEffect(() => {
    if (!mudou) return;
    const sair = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    const navegar = (e: MouseEvent) => {
      const a = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!a || a.target === "_blank" || e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || a.href === window.location.href) return;
      if (!confirm("Sair e descartar as alterações não salvas do formulário?")) { e.preventDefault(); e.stopPropagation(); }
    };
    window.addEventListener("beforeunload", sair); document.addEventListener("click", navegar, true);
    return () => { window.removeEventListener("beforeunload", sair); document.removeEventListener("click", navegar, true); };
  }, [mudou]);
  const editavel = atual?.estado === "RASCUNHO";
  return <section className="space-y-4"><h2 className="text-xl font-semibold">Biblioteca de formulários</h2><p>Crie por função, revise a experiência do candidato e configure a avaliação privada. As candidaturas mantêm a versão aplicada. Versões aprovadas só podem ser alteradas criando uma cópia.</p>
    <div className="flex flex-wrap gap-2">{modelos.map(m => <button className="btn" disabled={ocupado} key={m.funcao} onClick={() => selecionar({ ...structuredClone(m), id: "", estado: "RASCUNHO", revisao: 0, origemId: null })}>Criar: {m.funcao === "RECEPCAO" ? "Recepção" : m.funcao === "AUXILIAR" ? "Auxiliar" : "Barbeiro"}</button>)}</div>
    {erro && <p role="alert" className="text-red-500 whitespace-pre-wrap">{erro}</p>}{mensagem && <p role="status">{mensagem}</p>}
    <div className="crm-collection grid gap-3 md:grid-cols-2">{lista.map(f => <article className="cartao space-y-2" key={f.id}><h3 className="font-semibold">{f.titulo}</h3><p className="text-sm">{f.estado} · revisão {f.revisao} · {f.definicao.perguntas.length} perguntas</p><p className="text-xs break-all">Versão: {f.id}{f.origemId ? ` · origem: ${f.origemId}` : ""}</p><button className="btn" disabled={ocupado} onClick={() => selecionar(f)}>Abrir versão</button><button className="btn ml-2" disabled={ocupado} onClick={() => { if (!descartar()) return; void executar(() => api("/api/recrutamento/formularios", { method: "POST", body: { ...dados(f), titulo: `${f.titulo.slice(0, 85)} — cópia`, origemId: f.id } }), "Cópia criada em rascunho. Abra a nova versão para editar."); }}>Duplicar / nova versão</button></article>)}</div>
    {atual && <div className="space-y-4 border-t border-zinc-500/30 pt-4"><h3 className="text-xl font-semibold">{atual.id ? "Versão selecionada" : "Novo formulário"}</h3>
      <fieldset disabled={!editavel || ocupado} className="space-y-3"><label className="block">Título<input className="campo" maxLength={100} value={atual.titulo} onChange={e => setAtual({ ...atual, titulo: e.target.value })} /></label><label className="block">Função<select className="campo" value={atual.funcao} onChange={e => setAtual({ ...atual, funcao: e.target.value as FormularioGestao["funcao"] })}><option value="BARBEIRO">Barbeiro</option><option value="RECEPCAO">Recepção</option><option value="AUXILIAR">Auxiliar</option></select></label></fieldset>
      <nav className="crm-subtabs flex flex-wrap gap-2" aria-label="Editor de formulário">{[["perguntas", "Perguntas"], ["criterios", "Avaliação privada"], ["previa", "Prévia do candidato"]].map(([id, nome]) => <button aria-pressed={aba === id} className={aba === id ? "btn-primario" : "btn"} key={id} onClick={() => { setAba(id); setRespostas({}); }}>{nome}</button>)}</nav>
      {aba === "previa" ? <div className="cartao"><p className="text-sm text-ouro">Prévia: nada será enviado ou salvo.</p><PerguntasCandidato perguntas={atual.definicao.perguntas} respostas={respostas} alterar={setRespostas} /></div> : <fieldset disabled={!editavel || ocupado}>{aba === "perguntas" ? <EditorPerguntas d={atual.definicao} alterar={definicao => setAtual({ ...atual, definicao })} /> : <EditorCriterios d={atual.definicao} alterar={definicao => setAtual({ ...atual, definicao })} />}</fieldset>}
      <div className="flex flex-wrap gap-2">{editavel && <button className="btn-primario" disabled={ocupado} onClick={salvar}>Salvar rascunho</button>}{editavel && atual.id && <button className="btn" disabled={ocupado} onClick={() => transicao("APROVAR")}>Aprovar versão salva</button>}{atual.id && atual.estado !== "ARQUIVADO" && <button className="btn" disabled={ocupado} onClick={() => transicao("ARQUIVAR")}>Arquivar versão salva</button>}<button className="btn" disabled={ocupado} onClick={() => { if (descartar()) setAtual(null); }}>Fechar editor</button></div>
      <p className="text-sm text-zinc-500">Salve as alterações antes de aprovar. Remoção ou reordenação de perguntas pode exigir revisar condições e competências vinculadas.</p>
    </div>}
  </section>;
}
