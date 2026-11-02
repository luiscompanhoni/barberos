"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/cliente-api";
import { calcularAvaliacao, type Definicao, type Respostas } from "@/lib/recrutamento/formularios-regras";
type Item = { id: string; nivel: number | null; evidencia: string };
type Registro = { id: string; etapa: string; criterios: Item[]; nota: number | null; cobertura: number; usuarioId: string; criadoEm: string };
type Dados = { formularioSnapshot: Definicao | null; formularioVersao: string; respostas: Respostas | null; versao: number; avaliacoes: Registro[] };
export function AvaliacaoCandidato({ id, atualizou, aoAlterar }: { id: string; atualizou: () => void; aoAlterar?: (id: string, sujo: boolean) => void }) {
  const [sujo, setSujo] = useState(false);
  const [dados, setDados] = useState<Dados | null>(null); const [itens, setItens] = useState<Item[]>([]); const [etapa, setEtapa] = useState("FORMULARIO");
  const [erro, setErro] = useState(""); const [ocupado, setOcupado] = useState(false); const [mensagem, setMensagem] = useState("");
  useEffect(() => { aoAlterar?.(id, sujo); return () => aoAlterar?.(id, false); }, [id, sujo, aoAlterar]);
  useEffect(() => {
    if (!sujo) return;
    const sair = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    const navegar = (e: MouseEvent) => {
      const a = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!a || a.target === "_blank" || e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || a.href === window.location.href) return;
      if (!confirm("Sair e descartar a avaliação não salva?")) { e.preventDefault(); e.stopPropagation(); }
    };
    window.addEventListener("beforeunload", sair); document.addEventListener("click", navegar, true);
    return () => { window.removeEventListener("beforeunload", sair); document.removeEventListener("click", navegar, true); };
  }, [sujo]);
  async function carregar(confirmar = true) {
    if (confirmar && sujo && !confirm("Descartar a avaliação não salva e recarregar?")) return;
    setOcupado(true); setErro("");
    try { const d = await api<Dados>(`/api/recrutamento/candidaturas/${id}/avaliacao`); setDados(d); setSujo(false); setItens(d.formularioSnapshot?.criterios.map(c => ({ id: c.id, nivel: null, evidencia: "" })) ?? []); }
    catch (e) { setErro((e as Error).message); } finally { setOcupado(false); }
  }
  async function salvar() {
    if (!dados) return; setOcupado(true); setErro("");
    try { await api(`/api/recrutamento/candidaturas/${id}/avaliacao`, { method: "POST", body: { versao: dados.versao, etapa, criterios: itens } }); setMensagem("Avaliação registrada no histórico. A etapa da candidatura não foi alterada."); await carregar(false); atualizou(); }
    catch (e) { setErro((e as Error).message); } finally { setOcupado(false); }
  }
  const def = dados?.formularioSnapshot;
  let resultado: ReturnType<typeof calcularAvaliacao> | null = null;
  if (def) { try { resultado = calcularAvaliacao(def, itens); } catch { /* Evidências em elaboração: a nota só aparece após preenchimento. */ } }
  return <section className="space-y-3 border-t border-zinc-500/20 pt-3"><button className="btn" disabled={ocupado} onClick={() => void carregar()}>{dados ? "Recarregar avaliação" : "Respostas e avaliação privada"}</button>{erro && <p role="alert" className="text-red-500">{erro}</p>}{mensagem && <p role="status">{mensagem}</p>}
    {dados && !def && <p>Candidatura no modelo anterior. Preserve a análise no acompanhamento; não há pontuação retroativa.</p>}
    {def && <><p className="text-xs break-all">Versão aplicada: {dados!.formularioVersao}. Avaliação humana, sem rejeição automática.</p><details><summary className="cursor-pointer">Respostas declaradas</summary><dl>{def.perguntas.map(p => <div className="my-3" key={p.id}><dt className="font-medium">{p.texto}</dt><dd className="whitespace-pre-wrap text-sm">{Array.isArray(dados!.respostas?.[p.id]) ? (dados!.respostas![p.id] as string[]).join(" · ") : dados!.respostas?.[p.id] || "Não respondida / não exibida"}</dd></div>)}</dl></details>
    <label className="block">Etapa da evidência<select className="campo" disabled={ocupado} value={etapa} onChange={e => { if (sujo && !confirm("Descartar o rascunho antes de mudar a etapa da evidência?")) return; setSujo(false); setEtapa(e.target.value); setItens(def.criterios.map(c => ({ id: c.id, nivel: null, evidencia: "" }))); }}><option value="FORMULARIO">Declarado no formulário</option><option value="ENTREVISTA">Observado na entrevista</option><option value="PRATICA">Demonstrado na prática</option></select></label>
    {def.criterios.map((c, i) => <fieldset className="space-y-2 border border-zinc-500/20 p-3 rounded-xl" key={c.id}><legend>{c.nome} · {c.peso}% {c.critico ? "· crítica" : ""}</legend><p className="text-xs">Evidências: {c.perguntas.map(pid => def.perguntas.find(p => p.id === pid)?.texto).join(" · ")}</p><label className="block">Nível observado<select className="campo" disabled={ocupado} value={itens[i]?.nivel ?? ""} onChange={e => { setSujo(true); setItens(itens.map((x, n) => n === i ? { ...x, nivel: e.target.value === "" ? null : Number(e.target.value) } : x)); }}><option value="">Pendente / sem evidência suficiente</option>{c.rubrica.map((t, n) => <option value={n} key={n}>{n} — {t}</option>)}</select></label><label className="block">Evidência e justificativa<textarea className="campo" disabled={ocupado} maxLength={2000} value={itens[i]?.evidencia ?? ""} onChange={e => { setSujo(true); setItens(itens.map((x, n) => n === i ? { ...x, evidencia: e.target.value } : x)); }} /></label></fieldset>)}
    <p>Cobertura: {resultado?.cobertura ?? itens.filter(i => i.nivel !== null && i.evidencia.length >= 5).length}/{def.criterios.length}. {resultado?.nota == null ? "Avaliação incompleta" : `Nota interna: ${resultado.nota.toFixed(2)} / 10`}</p>{!!resultado?.criticosPendentes.length && <p className="text-ouro">Revisar competências críticas: {resultado.criticosPendentes.join(" · ")}. A média não substitui essa revisão.</p>}
    <button className="btn" disabled={ocupado} onClick={salvar}>Registrar avaliação humana</button><details><summary className="cursor-pointer">Histórico de avaliações (até 50 mais recentes)</summary>{dados!.avaliacoes.map(a => <article className="my-3 text-sm" key={a.id}><p>{a.etapa} · {new Date(a.criadoEm).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} · responsável {a.usuarioId}</p><p>{a.nota === null ? "Incompleta" : `${a.nota.toFixed(2)} / 10`} · cobertura {a.cobertura}/{def.criterios.length}</p>{a.criterios.map(c => <p key={c.id}>{def.criterios.find(x => x.id === c.id)?.nome}: {c.nivel ?? "pendente"} — {c.evidencia}</p>)}</article>)}</details></>}
  </section>;
}
