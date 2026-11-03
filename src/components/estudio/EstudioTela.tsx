"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, Check, Download, Clapperboard, Plus, Scissors, Trash2, Upload } from "lucide-react";
import { api } from "@/lib/cliente-api";
import { ATIVOS, LIMITES, ROTULOS } from "@/lib/estudio/regras";
import { PRESET_PADRAO, TEMPLATES, type Preset } from "@/lib/estudio/templates";
import type { Roteiro } from "@/lib/estudio/roteiro-tipos";
import { Templates } from "./Templates";
import { ImportarRoteiro, ReferenciaRoteiro } from "./Roteiros";
import { alterada, conferida, emConflito, iniciarMontagem, reduzirMontagem, type Clipe } from "./montagem";
import { ContadorCrm } from "@/components/visual/ContadorCrm";

type Versao = { id: string; numero: number; revisao: number; estado: string; disponivel: boolean; comentario: string | null; erro: string | null; bytes: number; aprovadaEm: string | null; preset: Preset };
type Projeto = { id: string; nome: string; revisao: number; clipes: Clipe[]; versoes: Versao[]; preset: Preset; titulo: string; chamada: string; roteiro: Roteiro | null };
type Dados = { projetos: Projeto[]; processadorDisponivel: boolean; processador1080Disponivel: boolean };
const base = "/api/estudio/projetos";
const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1) + " MB";
const ativo = (p: Projeto) => p.versoes.some(v => ATIVOS.some(e => e === v.estado));
const erroTexto = (e: unknown) => e instanceof Error ? e.message : "Não foi possível concluir.";

function duracao(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video"); const url = URL.createObjectURL(file);
    const limpar = () => { clearTimeout(timeout); v.removeAttribute("src"); v.load(); URL.revokeObjectURL(url); };
    const timeout = setTimeout(() => { limpar(); reject(new Error("Não foi possível ler este vídeo.")); }, 15_000);
    v.preload = "metadata";
    v.onloadedmetadata = () => { const d = v.duration; limpar(); if (Number.isFinite(d) && d > 0) resolve(d); else reject(new Error("Duração do vídeo inválida.")); };
    v.onerror = () => { limpar(); reject(new Error("Seu navegador não consegue ler este vídeo. Exporte em MP4 e envie novamente.")); };
    v.src = url;
  });
}

export function EstudioTela({ podeImportar = false, roteiroInicial }: { podeImportar?: boolean; roteiroInicial?: string }) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [nome, setNome] = useState("");
  const [preset, setPreset] = useState<Preset>(PRESET_PADRAO);
  const carregar = useCallback(async () => { const d = await api<Dados>(base); setDados(d); return d; }, []);
  useEffect(() => { let cancelado = false; void api<Dados>(base).then(d => { if (!cancelado) setDados(d); }).catch(e => { if (!cancelado) setErro(erroTexto(e)); }); return () => { cancelado = true; }; }, []);
  const pendente = dados?.projetos.some(ativo);
  useEffect(() => {
    const id = setInterval(() => { void carregar().catch(e => setErro(erroTexto(e))); }, pendente ? 4000 : 20000);
    return () => clearInterval(id);
  }, [carregar, pendente]);
  async function executar(fn: () => Promise<unknown>) {
    setErro(""); setOcupado(true);
    try { await fn(); await carregar(); }
    catch (e) { setErro(erroTexto(e)); await carregar().catch(() => {}); }
    finally { setOcupado(false); }
  }
  const p = dados?.projetos.find(p => p.id === selecionado);
  return <div className="space-y-5">
    <header className="black-dashboard__hero">

      <div className="relative flex items-start gap-4"><div className="rounded-xl border border-ouro/30 bg-ouro/10 p-3 text-ouro"><Clapperboard size={25} /></div><div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-ouro">Conteúdo da Black</p><h1 className="mt-1 text-2xl font-bold sm:text-3xl">Black Estúdio</h1><p className="mt-2 max-w-xl text-sm text-zinc-500">Do vídeo do seu trabalho à próxima publicação. Monte, revise e baixe em um só lugar.</p></div></div>
      <p className="relative mt-4 text-xs text-zinc-500">Seus projetos são privados. Exportação vertical com cortes, áudio original e textos da Black.</p>
    </header>
    {dados && !p && <section className="black-studio-summary" aria-label="Resumo dos seus projetos">
      <article className="cartao crm-kpi"><Clapperboard size={18} className="text-ouro" aria-hidden="true" /><strong><ContadorCrm valor={dados.projetos.length} /></strong><p>Projetos privados</p></article>
      <article className="cartao crm-kpi"><Scissors size={18} className="text-ouro" aria-hidden="true" /><strong><ContadorCrm valor={dados.projetos.reduce((n, projeto) => n + projeto.clipes.length, 0)} /></strong><p>Clipes enviados</p></article>
      <article className="cartao crm-kpi"><Check size={18} className="text-ouro" aria-hidden="true" /><strong><ContadorCrm valor={dados.projetos.reduce((n, projeto) => n + projeto.versoes.filter(v => v.estado === "APROVADO").length, 0)} /></strong><p>Versões aprovadas</p></article>
    </section>}
    {erro && <div role="alert" className="cartao border-red-500/30 text-sm text-red-500">{erro}<button className="btn ml-3" onClick={() => void executar(carregar)}>Atualizar</button></div>}
    {!dados ? <p role="status" className="cartao">Carregando seus projetos…</p> : <>
      <p className="flex items-center gap-2 text-xs text-zinc-500"><span className={"h-2 w-2 rounded-full " + (dados.processadorDisponivel ? "bg-emerald-500" : "bg-amber-500")} />{dados.processadorDisponivel ? "Montagem disponível" : "Montagem indisponível agora. Você pode preparar seus projetos."}</p>
      {p ? <Editor key={p.id} p={p} online={dados.processadorDisponivel} online1080={dados.processador1080Disponivel} ocupado={ocupado} executar={executar} carregar={carregar} voltar={() => setSelecionado(null)} /> : <>
        <section className="cartao"><Templates valor={preset} mudar={setPreset} desabilitado={ocupado} /></section>
        {podeImportar ? <ImportarRoteiro preset={preset} ocupado={ocupado} executar={executar} abrir={setSelecionado} inicial={roteiroInicial} /> : null}
        <form className="cartao flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={e => { e.preventDefault(); void executar(async () => { const novo = await api<{ id: string }>(base, { method: "POST", body: { nome, preset } }); setSelecionado(novo.id); setNome(""); }); }}>
          <label className="min-w-0 flex-1 text-sm">Nome do projeto<input className="campo mt-1 w-full" placeholder="Ex.: Degradê da semana" value={nome} onChange={e => setNome(e.target.value)} maxLength={80} minLength={2} required /></label>
          <button className="btn-primario flex items-center justify-center gap-2" disabled={ocupado || dados.projetos.length >= LIMITES.projetos}><Plus size={17} /> Novo projeto</button>
        </form>
        <div className="crm-collection grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{dados.projetos.map(p => <button key={p.id} onClick={() => setSelecionado(p.id)} className="cartao-clicavel crm-operation-card group text-left">
          <div className="mb-4 flex items-center justify-between"><Clapperboard className="text-ouro" size={23} /><span className="text-xs text-zinc-500">{p.clipes.length} vídeo(s)</span></div>
          <h2 className="break-words font-semibold group-hover:text-ouro">{p.nome}</h2><p className="mt-2 text-sm text-zinc-500">{p.versoes[0] ? ROTULOS[p.versoes[0].estado] : "Preparando a montagem"}</p>
        </button>)}</div>
        {!dados.projetos.length && <section className="cartao py-10 text-center"><Scissors className="mx-auto mb-3 text-ouro" size={32} /><h2 className="font-semibold">Seu próximo vídeo começa aqui</h2><p className="mx-auto mt-2 max-w-sm text-sm text-zinc-500">Crie um projeto e envie os vídeos do corte, da barba ou dos bastidores. Depois escolha a ordem e os trechos.</p></section>}
      </>}
    </>}
  </div>;
}

function Editor({ p, online, online1080, ocupado, executar, carregar, voltar }: { p: Projeto; online: boolean; online1080: boolean; ocupado: boolean; executar: (fn: () => Promise<unknown>) => Promise<void>; carregar: () => Promise<Dados>; voltar: () => void }) {
  const [montagem, despachar] = useReducer(reduzirMontagem, p, iniciarMontagem);
  if (p.revisao > montagem.servidor.revisao) despachar({ tipo: "receber", montagem: p });
  const { clipes, nome, preset, titulo, chamada } = montagem.rascunho;
  const setNome = (nome: string) => despachar({ tipo: "alterar", campos: { nome } });
  const setPreset = (preset: Preset) => despachar({ tipo: "alterar", campos: { preset } });
  const setTitulo = (titulo: string) => despachar({ tipo: "alterar", campos: { titulo } });
  const setChamada = (chamada: string) => despachar({ tipo: "alterar", campos: { chamada } });
  const setClipes = (clipes: Clipe[]) => despachar({ tipo: "alterar", campos: { clipes } });
  const formato = TEMPLATES[preset];
  const renderDisponivel = preset === "black-vertical-v1" ? online : online1080;
  const [envio, setEnvio] = useState("");
  const [comentario, setComentario] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const url = base + "/" + p.id;
  const v = p.versoes[0];
  const assistiu = conferida(montagem, v?.id);
  const setAssistiu = (sim: boolean) => despachar({ tipo: "conferir", versaoId: sim ? v.id : null });
  const emMontagem = ativo(p);
  const bloqueado = ocupado || emMontagem;
  const alterado = alterada(montagem);
  const conflito = emConflito(montagem);
  useEffect(() => {
    if (!alterado) return;
    const avisar = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [alterado]);
  const segundos = clipes.reduce((s, c) => s + c.fim - c.inicio, 0);
  const confirmar = (mensagem: string) => window.confirm(mensagem);
  function mover(indice: number, delta: number) { const n = [...clipes]; [n[indice], n[indice + delta]] = [n[indice + delta], n[indice]]; setClipes(n); }
  function mudar(id: string, campo: "inicio" | "fim" | "texto", valor: number | string) { setClipes(clipes.map(c => c.id === id ? { ...c, [campo]: valor } : c)); }
  async function enviar(files: FileList | null) {
    if (!files?.length) return;
    const lista = Array.from(files);
    await executar(async () => {
      if (p.clipes.length + lista.length > LIMITES.clipes) throw new Error("Cada projeto aceita até 20 vídeos.");
      if (lista.some(f => f.size > LIMITES.arquivo)) throw new Error("Cada vídeo pode ter até 100 MB.");
      if (lista.reduce((s, f) => s + f.size, 0) + p.clipes.reduce((s, c) => s + c.bytes, 0) > LIMITES.projeto) throw new Error("O projeto pode ter até 500 MB de vídeos.");
      for (const [i, file] of lista.entries()) {
        setEnvio("Enviando " + (i + 1) + " de " + lista.length + ": " + file.name);
        const mime = file.type || (/\.mov$/i.test(file.name) ? "video/quicktime" : /\.webm$/i.test(file.name) ? "video/webm" : "video/mp4");
        const d = await duracao(file);
        const atual = await api<Projeto>(url);
        const c = await api<{ id: string }>(url + "/clipes", { method: "POST", body: { nome: file.name, bytes: file.size, mime, duracao: d, revisao: atual.revisao } });
        const r = await fetch(url + "/clipes/" + c.id, { method: "PUT", headers: { "Content-Type": mime }, body: file });
        if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.erro || "O envio foi interrompido. Remova o vídeo pendente e envie novamente."); }
      }
    });
    setEnvio(""); if (input.current) input.current.value = "";
  }
  async function salvar() {
    await api(url, { method: "PATCH", body: { revisao: montagem.base.revisao, nome, preset, titulo, chamada, clipes: clipes.map(c => ({ id: c.id, inicio: c.inicio, fim: c.fim, texto: c.texto })) } });
    despachar({ tipo: "salvo", montagem: { ...montagem.rascunho, revisao: montagem.base.revisao + 1 } });
  }
  function avaliar(acao: "aprovar" | "ajustes" | "cancelar") {
    return executar(async () => { await api(url + "/versoes/" + v.id, { method: "POST", body: { acao, revisao: p.revisao, comentario: acao === "ajustes" ? comentario : undefined } }); setAssistiu(false); });
  }
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><button className="btn flex items-center gap-2" onClick={() => { if (!alterado || confirmar("Sair sem salvar as alterações da montagem?")) voltar(); }} disabled={ocupado}><ArrowLeft size={16} /> Projetos</button><button className="btn text-red-500" disabled={bloqueado} onClick={() => { if (confirmar("Excluir este projeto e todos os seus vídeos? Esta ação não pode ser desfeita.")) void executar(async () => { await api(url, { method: "DELETE", body: { revisao: p.revisao } }); voltar(); }); }}>Excluir projeto</button></div>
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_350px]">
      <section className="cartao min-w-0 space-y-5">
        <div><h2 className="text-lg font-semibold">1. Prepare sua montagem</h2><p className="mt-1 text-sm text-zinc-500">Até 20 vídeos · 100 MB por vídeo · 500 MB por projeto</p></div>
        {conflito && <div role="alert" className="rounded-xl border border-amber-500/40 p-3 text-sm"><p>Este projeto mudou em outra sessão. Suas alterações continuam aqui para consulta e cópia. Carregue a versão atual antes de editar novamente.</p><button className="btn mt-2" disabled={ocupado} onClick={() => { if (confirmar("Descartar suas alterações não salvas e carregar a versão atual?")) despachar({ tipo: "descartar" }); }}>Descartar minhas alterações e carregar versão atual</button></div>}
        <label className="block text-sm">Nome<input className="campo mt-1 w-full" value={nome} maxLength={80} minLength={2} disabled={bloqueado} onChange={e => setNome(e.target.value)} /></label>
        <Templates valor={preset} desabilitado={bloqueado} classico={p.preset === "black-vertical-v1"} mudar={novo => {
          if (!titulo || titulo === TEMPLATES[preset].titulo) setTitulo(TEMPLATES[novo].titulo);
          if (!chamada || chamada === TEMPLATES[preset].chamada) setChamada(TEMPLATES[novo].chamada);
          setPreset(novo);
        }} />
        {preset !== "black-vertical-v1" ? <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Título do vídeo<input className="campo mt-1 w-full" maxLength={70} value={titulo} disabled={bloqueado} onChange={e => setTitulo(e.target.value)} /></label><label className="text-sm">Chamada nos últimos 3 segundos<input className="campo mt-1 w-full" maxLength={70} value={chamada} disabled={bloqueado} onChange={e => setChamada(e.target.value)} /></label></div> : null}
        <div className="rounded-xl border border-dashed border-ouro/40 bg-ouro/5 p-5 text-center"><Upload className="mx-auto mb-2 text-ouro" size={25} /><label className={"btn inline-flex cursor-pointer " + (bloqueado || alterado ? "opacity-50" : "")}>Escolher vídeos<input ref={input} type="file" multiple accept="video/mp4,video/quicktime,video/webm,.mov" className="sr-only" disabled={bloqueado || alterado || clipes.length >= 20} onChange={e => void enviar(e.target.files)} /></label><p className="mt-2 text-xs text-zinc-500">MP4, MOV ou WebM. Os originais permanecem privados.</p>{envio && <p role="status" className="mt-2 break-all text-sm text-ouro">{envio}</p>}</div>
        <div className="space-y-4">{clipes.map((c, i) => <article key={c.id} className="min-w-0 space-y-3 rounded-xl border border-zinc-200 p-3">
          <div className="flex items-start gap-2"><span className="rounded bg-ouro/10 px-2 py-1 text-xs text-ouro">{i + 1}</span><div className="min-w-0 flex-1"><p className="break-all text-sm font-medium">{c.nome}</p><p className="text-xs text-zinc-500">{mb(c.bytes)} · {c.duracao.toFixed(1)} s</p></div><button className="btn p-2" aria-label={"Remover " + c.nome} disabled={bloqueado || alterado} onClick={() => void executar(() => api(url + "/clipes/" + c.id, { method: "DELETE", body: { revisao: p.revisao } }))}><Trash2 size={16} /></button></div>
          {c.pronto ? <>
            <video controls playsInline preload="metadata" src={url + "/clipes/" + c.id} className="max-h-48 w-full rounded-lg bg-black" aria-label={"Original: " + c.nome} />
            <div className="grid grid-cols-2 gap-3"><label className="min-w-0 text-xs">Início (segundos)<input type="number" className="campo mt-1 w-full" min={0} max={c.duracao} step={0.1} value={c.inicio} disabled={bloqueado} onChange={e => mudar(c.id, "inicio", Number(e.target.value))} /></label><label className="min-w-0 text-xs">Fim (segundos)<input type="number" className="campo mt-1 w-full" min={0.1} max={c.duracao} step={0.1} value={c.fim} disabled={bloqueado} onChange={e => mudar(c.id, "fim", Number(e.target.value))} /></label></div>
            <label className="block text-xs">Texto sobre este trecho<input className="campo mt-1 w-full" maxLength={100} value={c.texto} placeholder="Ex.: Acabamento que faz a diferença" disabled={bloqueado} onChange={e => mudar(c.id, "texto", e.target.value)} /></label>
            <div className="flex gap-2"><button className="btn flex items-center gap-1 text-xs" aria-label={"Antecipar " + c.nome} disabled={bloqueado || i === 0} onClick={() => mover(i, -1)}><ArrowUp size={14} /> Antes</button><button className="btn flex items-center gap-1 text-xs" aria-label={"Adiar " + c.nome} disabled={bloqueado || i === clipes.length - 1} onClick={() => mover(i, 1)}><ArrowDown size={14} /> Depois</button></div>
          </> : <p className="text-sm text-amber-500">Envio pendente. Remova este item e envie o arquivo novamente.</p>}
        </article>)}</div>
        <div className="flex flex-wrap items-center justify-between gap-3"><p className={"text-sm " + (segundos > 120 ? "text-red-500" : "text-zinc-500")}>{segundos.toFixed(1)} / 120 segundos</p><button className="btn" disabled={bloqueado || conflito || !alterado || clipes.some(c => !c.pronto)} onClick={() => void executar(salvar)}>Salvar montagem</button></div>
        {alterado && <p role="status" className="text-xs text-amber-500">Salve a montagem antes de enviar mais arquivos ou gerar o vídeo.</p>}
      </section>
      <div className="space-y-4">
        {p.roteiro ? <ReferenciaRoteiro roteiro={p.roteiro} /> : null}
        <section className="cartao space-y-4"><h2 className="text-lg font-semibold">2. Gere e revise</h2><div className="rounded-xl border border-ouro/20 bg-ouro/5 p-3 text-sm"><p className="font-semibold text-ouro">{formato.nome}</p><p className="mt-1 text-zinc-500">{formato.largura} × {formato.altura} · 30 fps · áudio original</p><p className="mt-2 text-xs text-zinc-500">Confira o enquadramento vertical, os textos e o áudio antes de aprovar.</p></div><button className="btn-primario w-full" disabled={bloqueado || alterado || !renderDisponivel || !clipes.length || clipes.some(c => !c.pronto)} onClick={() => void executar(() => api(url + "/versoes", { method: "POST", body: { revisao: p.revisao } }))}>{v ? "Gerar nova versão" : "Gerar vídeo"}</button>
          {!renderDisponivel && <p role="status" className="text-xs text-amber-600">Processador indisponível para este formato. Você pode preparar e salvar a montagem.</p>}
          {v && <div className="space-y-3"><p role="status" className="text-sm font-semibold text-ouro">Versão {v.numero} · {ROTULOS[v.estado]} · {TEMPLATES[v.preset].largura} × {TEMPLATES[v.preset].altura}</p>{v.erro && <p className="text-sm text-red-500">{v.erro}</p>}{emMontagem && <><p className="text-sm text-zinc-500">{online ? "A montagem continua mesmo se você sair desta tela." : "O processador está offline. A tarefa aguarda recuperação ou cancelamento."}</p><button className="btn" disabled={ocupado} onClick={() => void avaliar("cancelar")}>Cancelar montagem</button></>}
            {v.disponivel && <><video key={v.id} controls playsInline preload="metadata" src={url + "/versoes/" + v.id} className="max-h-[520px] w-full rounded-xl bg-black" aria-label={"Prévia da versão " + v.numero} />{v.estado === "APROVADO" ? <a className="btn flex items-center justify-center gap-2" href={url + "/versoes/" + v.id + "?download=1"}><Download size={16} /> Baixar MP4 aprovado</a> : <p className="text-xs text-zinc-500">Prévia para revisão. O download final será liberado após sua aprovação.</p>}</>}
            {v.revisao !== p.revisao && <p className="text-xs text-amber-500">A montagem mudou desde esta versão. Gere outra para aprovar as alterações.</p>}
            {v.estado === "REVISAO" && v.revisao === p.revisao && <><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={assistiu} onChange={e => setAssistiu(e.target.checked)} className="mt-1 accent-amber-500" /> Assisti a esta versão e conferi imagem, texto e áudio.</label><button className="btn-primario flex w-full items-center justify-center gap-2" disabled={ocupado || alterado || !assistiu} onClick={() => void avaliar("aprovar")}><Check size={16} /> Aprovar esta versão</button><label className="block text-sm">O que precisa mudar?<textarea className="campo mt-1 w-full" rows={3} value={comentario} maxLength={1000} onChange={e => setComentario(e.target.value)} placeholder="Anote os ajustes antes de editar novamente." /></label><button className="btn w-full" disabled={ocupado || alterado || !comentario.trim()} onClick={() => void avaliar("ajustes")}>Registrar ajustes</button></>}
            {v.comentario && <div className="rounded-lg border border-zinc-200 p-3 text-sm"><p className="font-semibold">Ajustes solicitados</p><p className="mt-1 whitespace-pre-wrap">{v.comentario}</p><p className="mt-2 text-xs text-zinc-500">Edite a montagem e gere outra versão para revisar.</p></div>}
            {v.estado === "APROVADO" && <p className="text-sm text-emerald-500">Versão aprovada e disponível para download.</p>}
          </div>}
        </section>
        <section className="cartao text-xs text-zinc-500"><p>A aprovação vale apenas para esta versão do vídeo. Publicação, anúncios e envios continuam desativados neste fluxo.</p></section>
        {p.versoes.length > 1 && <details className="cartao"><summary className="cursor-pointer text-sm font-semibold">Versões anteriores ({p.versoes.length - 1})</summary><div className="mt-3 space-y-3">{p.versoes.slice(1).map(v => <div key={v.id} className="text-xs"><p>Versão {v.numero} · {ROTULOS[v.estado]} · {TEMPLATES[v.preset].largura} × {TEMPLATES[v.preset].altura}</p>{v.disponivel && v.estado === "APROVADO" && <a className="mt-1 inline-block text-ouro underline" href={url + "/versoes/" + v.id + "?download=1"}>Baixar vídeo</a>}</div>)}</div></details>}
        <button className="btn w-full" disabled={ocupado} onClick={() => void executar(carregar)}>Atualizar status</button>
      </div>
    </div>
  </div>;
}
