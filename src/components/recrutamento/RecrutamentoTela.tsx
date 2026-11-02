"use client";
import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "@/lib/cliente-api";
import { AVISO_PRIVACIDADE, ETAPAS, ROTULOS } from "@/lib/recrutamento/regras";
import { FormulariosTela, type FormularioGestao } from "./FormulariosTela";
import { AvaliacaoCandidato } from "./AvaliacaoCandidato";
type Vaga = { id: string; titulo: string; cidade: string; descricao: string; privacidade: string; ativa: boolean; versao: number; formularioId: string | null; link: string; _count: { candidaturas: number } };
type Candidatura = {
  id: string; etapa: (typeof ETAPAS)[number]; versao: number; criadoEm: string;
  candidato: { nome: string; telefone: string; cidade: string }; vaga: { titulo: string };
  experienciaMeses: number; servicos: string[]; disponibilidade: string; portfolio: string; instagram: string;
  vagaSnapshot: { titulo: string; cidade: string; descricao: string; funcao: string; formularioTitulo: string } | null;
  futurasOportunidades: boolean; origem: Record<string, string>;
  historico: { id: string; etapa: (typeof ETAPAS)[number]; motivo: string; criadoEm: string }[];
};
type Lista = { candidaturas: Candidatura[]; total: number; pagina: number };
function EditorVaga({ vaga, ocupado, salvar, formularios }: { formularios: FormularioGestao[]; vaga?: Vaga; ocupado: boolean; salvar: (e: FormEvent<HTMLFormElement>, v?: Vaga) => Promise<void> }) {
  return <form onSubmit={(e) => salvar(e, vaga)} className="space-y-4">
    <label className="block">Título<input className="campo" name="titulo" required minLength={2} maxLength={100} defaultValue={vaga?.titulo} /></label>
    <label className="block">Cidade<input className="campo" name="cidade" required minLength={2} maxLength={100} defaultValue={vaga?.cidade} /></label>
    <label className="block">Condições, atividades e requisitos<textarea className="campo" name="descricao" required minLength={2} maxLength={4000} rows={5} defaultValue={vaga?.descricao} /></label>
    <label className="block">Aviso sobre os dados<textarea className="campo" name="privacidade" required minLength={2} maxLength={3000} rows={6} defaultValue={vaga?.privacidade ?? AVISO_PRIVACIDADE} /></label>
    <p className="text-sm text-zinc-500">Complete o aviso com o prazo de conservação e o canal para pedidos sobre os dados antes de abrir a seleção.</p>
    <label className="block">Versão do formulário<select className="campo" name="formularioId" defaultValue={vaga?.formularioId ?? ""}><option value="">Modelo original de barbeiro</option>{vaga?.formularioId && !formularios.some(f => f.id === vaga.formularioId) && <option value={vaga.formularioId}>Versão atual: {vaga.formularioId}</option>}{formularios.filter(f => f.estado === "APROVADO" || f.id === vaga?.formularioId).map(f => <option key={f.id} value={f.id}>{f.titulo} · {f.id} · {f.estado}</option>)}</select></label>
    <button className="btn-primario" disabled={ocupado}>{vaga ? "Atualizar rascunho" : "Salvar rascunho"}</button>
  </form>;
}
export function RecrutamentoTela() {
  const [avaliacoesAlteradas, setAvaliacoesAlteradas] = useState<Record<string, boolean>>({});
  const alterarRascunho = useCallback((id: string, sujo: boolean) => setAvaliacoesAlteradas(a => a[id] === sujo || (!a[id] && !sujo) ? a : { ...a, [id]: sujo }), []);
  const [formularioAlterado, setFormularioAlterado] = useState(false);
  const [formularios, setFormularios] = useState<FormularioGestao[]>([]);
  const [vagas, setVagas] = useState<Vaga[]>([]); const [dados, setDados] = useState<Lista | null>(null);
  const [erro, setErro] = useState(""); const [mensagem, setMensagem] = useState("");
  const [aba, setAba] = useState<"candidatos" | "vagas" | "formularios">("candidatos");
  const [filtro, setFiltro] = useState({ vagaId: "", etapa: "", busca: "", pagina: 1 });
  const [revisao, setRevisao] = useState(0); const [ocupado, setOcupado] = useState(false);
  useEffect(() => {
    let ativo = true; const qs = new URLSearchParams({ pagina: String(filtro.pagina) });
    if (filtro.vagaId) qs.set("vagaId", filtro.vagaId); if (filtro.etapa) qs.set("etapa", filtro.etapa); if (filtro.busca) qs.set("busca", filtro.busca);
    Promise.all([api<{ vagas: Vaga[] }>("/api/recrutamento/vagas"), api<Lista>(`/api/recrutamento/candidaturas?${qs}`), api<{ formularios: FormularioGestao[] }>("/api/recrutamento/formularios")])
      .then(([v, d, f]) => { if (ativo) { setFormularios(f.formularios); setVagas(v.vagas); setDados(d); setErro(""); } }).catch((e) => { if (ativo) setErro(e.message); });
    return () => { ativo = false; };
  }, [filtro, revisao, aba]);
  function trocarAba(nova: typeof aba) { if (nova !== aba && (formularioAlterado || Object.values(avaliacoesAlteradas).some(Boolean)) && !confirm("Descartar os rascunhos não salvos antes de trocar de aba?")) return; setAba(nova); }
  function mudarFiltro(novo: typeof filtro) { if (Object.values(avaliacoesAlteradas).some(Boolean) && !confirm("Descartar as avaliações não salvas antes de mudar a lista?")) return; setFiltro(novo); }
  async function salvarVaga(e: FormEvent<HTMLFormElement>, v?: Vaga) {
    e.preventDefault(); const form = e.currentTarget; const f = new FormData(form); setOcupado(true); setErro("");
    try {
      await api("/api/recrutamento/vagas", { method: v ? "PATCH" : "POST", body: { ...(v ? { id: v.id, versao: v.versao } : {}), ativa: false, titulo: f.get("titulo"), cidade: f.get("cidade"), descricao: f.get("descricao"), privacidade: f.get("privacidade"), formularioId: f.get("formularioId") || null } });
      if (!v) form.reset(); setRevisao((x) => x + 1); setMensagem("Rascunho salvo. Revise as condições e o aviso antes de abrir as inscrições.");
    } catch (e) { setErro((e as Error).message); } finally { setOcupado(false); }
  }
  async function publicar(v: Vaga) {
    setOcupado(true); setErro("");
    try { await api("/api/recrutamento/vagas", { method: "PATCH", body: { id: v.id, versao: v.versao, ativa: !v.ativa } }); setRevisao((x) => x + 1); setMensagem(v.ativa ? "Inscrições encerradas." : "Inscrições abertas. O formulário pode ser compartilhado."); }
    catch (e) { setErro((e as Error).message); } finally { setOcupado(false); }
  }
  async function excluir(c: Candidatura) {
    if (!confirm(`Excluir a candidatura de ${c.candidato.nome}? Os dados pessoais são apagados e não dá para desfazer.`)) return;
    setOcupado(true); setErro("");
    try { await api(`/api/recrutamento/candidaturas/${c.id}`, { method: "DELETE" }); setRevisao((x) => x + 1); setMensagem("Candidatura excluída."); }
    catch (e) { setErro((e as Error).message); } finally { setOcupado(false); }
  }
  async function etapa(e: FormEvent<HTMLFormElement>, c: Candidatura) {
    e.preventDefault(); const f = new FormData(e.currentTarget); setOcupado(true); setErro("");
    try { await api(`/api/recrutamento/candidaturas/${c.id}`, { method: "PATCH", body: { etapa: f.get("etapa"), motivo: f.get("motivo"), versao: c.versao } }); setRevisao((x) => x + 1); setMensagem("Acompanhamento salvo."); }
    catch (e) { setErro((e as Error).message); } finally { setOcupado(false); }
  }
  return <div className="space-y-5">
    <header className="flex flex-wrap justify-between items-end gap-3"><div><p className="eyebrow">Equipe Black</p><h1 className="titulo-marca text-3xl">Recrutamento</h1><p className="text-sm text-zinc-500">Banco de talentos e acompanhamento das seleções.</p></div><Link className="btn" href="/rh">Ir para RH</Link></header>
    <div className="grid grid-cols-2 gap-3"><section className="cartao"><p className="text-sm text-zinc-500">Inscrições abertas</p><strong className="text-3xl text-ouro">{dados ? vagas.filter((v) => v.ativa).length : "—"}</strong></section><section className="cartao"><p className="text-sm text-zinc-500">Candidaturas no filtro</p><strong className="text-3xl text-ouro">{dados?.total ?? "—"}</strong></section></div>
    <nav className="flex flex-wrap gap-2" aria-label="Recrutamento"><button className={aba === "candidatos" ? "btn-primario" : "btn"} onClick={() => trocarAba("candidatos")}>Candidatos</button><button className={aba === "vagas" ? "btn-primario" : "btn"} onClick={() => trocarAba("vagas")}>Vagas</button><button className={aba === "formularios" ? "btn-primario" : "btn"} onClick={() => trocarAba("formularios")}>Formulários e critérios</button></nav>
    {erro && <p role="alert" className="cartao text-red-500">{erro}</p>}{mensagem && <p role="status" className="text-sm text-ouro">{mensagem}</p>}
    {aba === "formularios" ? <FormulariosTela aoAlterar={setFormularioAlterado} /> : aba === "vagas" ? <div className="grid gap-4 xl:grid-cols-2">
      <section className="cartao space-y-4"><h2 className="text-xl font-semibold">Nova vaga</h2><EditorVaga formularios={formularios} ocupado={ocupado} salvar={salvarVaga} /></section>
      <div className="space-y-3">{vagas.map((v) => <section className="cartao space-y-3" key={v.id}><div className="flex justify-between gap-2"><h2 className="font-semibold">{v.titulo}</h2><span className="text-sm text-ouro">{v.ativa ? "Aberta" : "Fechada / rascunho"}</span></div><p>{v.cidade} · {v._count.candidaturas} candidatura(s)</p><p className="break-all text-xs text-zinc-500">{v.link}</p>
        <details><summary className="cursor-pointer text-sm">Condições e aviso sobre dados</summary><p className="mt-2 whitespace-pre-wrap text-sm">{v.descricao}</p><p className="mt-2 whitespace-pre-wrap text-xs text-zinc-500">{v.privacidade}</p></details>
        {!v.ativa && <details><summary className="cursor-pointer text-sm">Editar rascunho</summary><div className="mt-3"><EditorVaga formularios={formularios} vaga={v} ocupado={ocupado} salvar={salvarVaga} /></div></details>}
        <div className="flex flex-wrap gap-2">{v.ativa && <a className="btn" href={v.link} target="_blank" rel="noopener noreferrer">Abrir formulário</a>}<button className="btn" disabled={ocupado} onClick={() => publicar(v)}>{v.ativa ? "Encerrar inscrições" : "Abrir inscrições"}</button></div></section>)}{!vagas.length && <p className="cartao text-zinc-500">Nenhuma vaga cadastrada.</p>}</div>
    </div> : <div className="space-y-4">
      <div className="cartao grid gap-3 sm:grid-cols-3"><label>Vaga<select className="campo" value={filtro.vagaId} onChange={(e) => mudarFiltro({ ...filtro, vagaId: e.target.value, pagina: 1 })}><option value="">Todas as vagas</option>{vagas.map((v) => <option value={v.id} key={v.id}>{v.titulo}</option>)}</select></label><label>Etapa<select className="campo" value={filtro.etapa} onChange={(e) => mudarFiltro({ ...filtro, etapa: e.target.value, pagina: 1 })}><option value="">Todas as etapas</option>{ETAPAS.map((x) => <option key={x} value={x}>{ROTULOS[x]}</option>)}</select></label><label>Buscar por nome<input className="campo" maxLength={100} value={filtro.busca} onChange={(e) => mudarFiltro({ ...filtro, busca: e.target.value, pagina: 1 })} /></label></div>
      <p className="text-sm text-zinc-500">Ordem de chegada, mais recentes primeiro. A avaliação e a decisão são da gestão; não há pontuação automática.</p>
      {!dados && !erro && <p role="status">Carregando candidaturas…</p>}{dados?.total === 0 && <section className="cartao"><h2 className="font-semibold">Nenhuma candidatura encontrada</h2><p className="text-sm text-zinc-500">Abra uma vaga e compartilhe o formulário para começar a receber cadastros.</p></section>}
      <div className="grid gap-4 xl:grid-cols-2">{dados?.candidaturas.map((c) => <article className="cartao space-y-3" key={c.id}>
        <header className="flex justify-between gap-2"><div><h2 className="font-semibold text-lg">{c.candidato.nome}</h2><p className="text-sm text-zinc-500">{c.vagaSnapshot?.titulo ?? c.vaga.titulo} · {c.candidato.cidade}</p></div><span className="text-sm text-ouro">{ROTULOS[c.etapa]}</span></header>
        {c.vagaSnapshot ? <details><summary className="cursor-pointer text-sm">Condições no recebimento</summary><p className="text-sm">{c.vagaSnapshot.cidade} · {c.vagaSnapshot.formularioTitulo}</p><p className="text-sm whitespace-pre-wrap">{c.vagaSnapshot.descricao}</p></details> : <p className="text-xs text-zinc-500">Título atual da vaga. Este registro não tem cópia histórica das condições.</p>}
        <p className="text-sm">WhatsApp declarado: {c.candidato.telefone}</p><p className="text-sm">Experiência declarada: {c.experienciaMeses} meses</p><p className="text-sm">{c.servicos.join(" · ")}</p><p className="whitespace-pre-wrap text-sm">{c.disponibilidade}</p>
        <div className="flex flex-wrap gap-3 text-sm">{c.portfolio && <a className="text-ouro underline" href={c.portfolio} rel="noopener noreferrer" target="_blank">Portfólio</a>}{c.instagram && <a className="text-ouro underline" href={c.instagram} rel="noopener noreferrer" target="_blank">Instagram profissional</a>}</div>
        <p className="text-xs text-zinc-500">Recebido: {new Date(c.criadoEm).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}. Futuras oportunidades: {c.futurasOportunidades ? "autorizadas" : "não autorizadas"}.</p>
        {Object.keys(c.origem).length > 0 && <p className="text-xs break-words text-zinc-500">Origem declarada: {Object.entries(c.origem).map(([k, v]) => `${k}: ${v}`).join(" · ")}</p>}
        <form key={c.versao} className="space-y-2 border-t border-zinc-500/20 pt-3" onSubmit={(e) => etapa(e, c)}><label className="block text-sm">Etapa<select className="campo" name="etapa" defaultValue={c.etapa}>{ETAPAS.filter((x) => x !== "BANCO" || c.futurasOportunidades).map((x) => <option key={x} value={x}>{ROTULOS[x]}</option>)}</select></label><label className="block text-sm">Registro da análise profissional<textarea className="campo" name="motivo" minLength={2} maxLength={1500} required rows={2} placeholder="Evidências do trabalho, entrevista ou próximo passo." /></label><div className="flex flex-wrap gap-2"><button className="btn" disabled={ocupado}>Salvar acompanhamento</button><button type="button" className="btn-perigo" disabled={ocupado} onClick={() => excluir(c)}>Excluir dados</button></div></form>
        <AvaliacaoCandidato aoAlterar={alterarRascunho} id={c.id} atualizou={() => setRevisao(x => x + 1)} />
        {c.historico.length > 0 && <details><summary className="cursor-pointer text-sm">Histórico recente</summary><ol className="mt-2 space-y-2 text-xs">{c.historico.map((h) => <li className="whitespace-pre-wrap" key={h.id}>{ROTULOS[h.etapa]} · {new Date(h.criadoEm).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}: {h.motivo}</li>)}</ol></details>}
      </article>)}</div>
      {dados && dados.total > 30 && <div className="flex items-center justify-between gap-2"><button className="btn" disabled={filtro.pagina <= 1} onClick={() => mudarFiltro({ ...filtro, pagina: filtro.pagina - 1 })}>Anterior</button><span>Página {dados.pagina}</span><button className="btn" disabled={filtro.pagina * 30 >= dados.total} onClick={() => mudarFiltro({ ...filtro, pagina: filtro.pagina + 1 })}>Próxima</button></div>}
    </div>}
  </div>;
}
