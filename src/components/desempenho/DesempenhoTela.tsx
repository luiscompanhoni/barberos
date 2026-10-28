"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarCheck, Clock3, Medal } from "lucide-react";
import { SeloNivel } from "@/components/checklist/SeloNivel";
import { api, reais } from "@/lib/cliente-api";
import { AdesaoPainel } from "./AdesaoPainel";
import { AvaliacaoLiderForm } from "./AvaliacaoLiderForm";
import { PresencaPainel } from "./PresencaPainel";
import { ProgramaForm } from "./ProgramaForm";
import { ConquistaNivel } from "./ConquistaNivel";
import type { Acao, PainelDesempenho } from "./tipos";

export function DesempenhoTela() {
  const [competencia, setCompetencia] = useState(""), [pessoaId, setPessoaId] = useState("");
  const [dados, setDados] = useState<PainelDesempenho | null>(null), [versao, setVersao] = useState(0);
  const [aba, setAba] = useState("resumo"), [erro, setErro] = useState(""), [msg, setMsg] = useState(""), [salvando, setSalvando] = useState(false);
  useEffect(() => {
    let vivo = true;
    const q = new URLSearchParams();
    if (competencia) q.set("competencia", competencia);
    if (pessoaId) q.set("pessoaId", pessoaId);
    api<PainelDesempenho>(`/api/desempenho?${q}`).then((r) => { if (vivo) setDados(r); }).catch((e) => { if (vivo) setErro(e.message); });
    return () => { vivo = false; };
  }, [competencia, pessoaId, versao]);
  const acao: Acao = async (body) => {
    if (salvando) return false;
    setErro(""); setMsg(""); setSalvando(true);
    try { await api("/api/desempenho", { method: "POST", body }); setMsg("Registro salvo."); setVersao((v) => v + 1); return true; }
    catch (e) { setErro((e as Error).message); return false; }
    finally { setSalvando(false); }
  };
  const r = dados?.resumo, propria = !!r && r.pessoa.usuarioId === dados?.contexto.usuarioId;
  return <div className="space-y-5">
    {r && propria && r.competencia === dados?.contexto.hoje.slice(0, 7) && <ConquistaNivel pessoaId={r.pessoa.id} nivel={r.nivel} />}
    <div><p className="eyebrow">Cultura Black</p><h1 className="titulo-marca flex items-center gap-2"><Medal aria-hidden="true" /> Presença e desempenho</h1><p className="mt-2 text-sm text-zinc-500">Acompanhe seus registros, critérios e evolução. Bônus depende de adesão, regras vigentes e aprovação.</p></div>
    {erro && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{erro}</p>}
    {msg && <p role="status" className="text-sm text-emerald-700">{msg}</p>}
    {!dados ? <p className="text-sm text-zinc-500">Carregando desempenho…</p> : <>
      <div className="flex flex-wrap gap-3">
        <label className="text-sm">Competência<input type="month" className="campo mt-1" value={competencia || dados.competencia} onChange={(e) => setCompetencia(e.target.value)} /></label>
        {dados.contexto.avaliar && <label className="min-w-48 text-sm">Pessoa<select className="campo mt-1" value={pessoaId || r?.pessoa.id || ""} onChange={(e) => setPessoaId(e.target.value)}>{dados.pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome}{p.ativo ? "" : " (inativo)"}</option>)}</select></label>}
      </div>
      <nav aria-label="Seções de desempenho" className="flex flex-wrap gap-2">{[["resumo", "Resumo"], ["presenca", "Marcações"], ["adesao", "Adesão e horários"], ...(dados.contexto.dono ? [["regras", "Regras do programa"]] : [])].map(([valor, texto]) => <button key={valor} className={aba === valor ? "btn-primario" : "btn"} aria-current={aba === valor ? "page" : undefined} onClick={() => setAba(valor)}>{texto}</button>)}</nav>
      {!r && aba !== "regras" && <div className="cartao space-y-3">{dados.contexto.dono ? <><p>Cadastre o vínculo de RH da equipe para começar.</p><p className="text-sm text-zinc-500">Em Configurações → Acessos da equipe, abra “Editar cadastro”, escolha a função do checklist e salve. Depois volte para propor a adesão e os horários.</p><Link className="btn-primario inline-flex" href="/equipe">Abrir acessos da equipe</Link></> : <p>Seu acesso ainda não está vinculado ao cadastro do RH. Peça ao dono para conferir seu cadastro em Acessos da equipe.</p>}</div>}
      {r && aba === "resumo" && <>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="cartao"><p className="rotulo">Faixa acumulada</p><SeloNivel nivel={r.nivel} /><p className="mt-2 text-sm">{r.pontos} pontos até o fim do período</p></div>
          <div className="cartao"><p className="rotulo"><Clock3 size={14} className="mr-1 inline" /> Presença</p><p className="numero-kpi">{r.presenca.percentual?.toFixed(0) ?? "—"}%</p><p className="text-xs text-zinc-500">{r.presenca.cumpridos}/{r.presenca.previstos} dias · {r.presenca.pendentes} pendentes</p></div>
          <div className="cartao"><p className="rotulo"><CalendarCheck size={14} className="mr-1 inline" /> Checklist</p><p className="numero-kpi">{r.checklist.validados}/{r.checklist.total}</p><p className="text-xs text-zinc-500">Tarefas validadas</p></div>
          <div className="cartao"><p className="rotulo">Nota dos clientes</p><p className={`numero-kpi ${r.clientes.media === null ? "text-zinc-500" : r.clientes.media >= 4.5 ? "text-emerald-700" : r.clientes.media >= 4 ? "text-amber-700" : "text-red-700"}`}>{r.clientes.media?.toFixed(1) ?? "—"}<span className="text-sm"> / 5</span></p><p className="text-xs text-zinc-500">{r.clientes.quantidade >= 5 ? `${r.clientes.quantidade} avaliações publicadas no mês` : "Avaliações ainda em formação"}</p></div>
        </div>
        <section className="cartao space-y-3"><h2 className="font-semibold">Bônus da competência</h2><p>{r.fechado ? `Aprovado: ${reais(r.fechado.valorCentavos)}` : `Valor da faixa: ${reais(r.resultado.previstoCentavos)}`}</p>
          <p className="text-sm text-zinc-500">A faixa acumulada é preservada. O bônus é conferido a cada mês; nenhuma pendência gera desconto automático.</p>
          {r.resultado.criterios.map((c) => <p key={c.nome} className={`text-sm ${c.cumpriu ? "text-emerald-700" : "text-zinc-600"}`}>{c.cumpriu ? "✓" : "○"} <b>{c.nome}</b>: {c.detalhe}</p>)}
          {!r.fechado && r.resultado.pendencias.length > 0 && <ul className="list-inside list-disc text-sm text-amber-700">{r.resultado.pendencias.map((p) => <li key={p}>{p}</li>)}</ul>}
          {r.fechado && <p className="text-sm text-emerald-700">Critérios preservados na aprovação de {new Date(r.fechado.criadoEm).toLocaleDateString("pt-BR", { timeZone: r.fuso })}{r.fechado.memoria ? ` · BLACK ${r.fechado.memoria.nivel} · ${r.fechado.memoria.resultado.pontos} pontos concedidos` : ""}.</p>}
          {dados.contexto.dono && !r.fechado && <button className="btn-primario" disabled={salvando || !r.resultado.elegivel} onClick={() => acao({ acao: "aprovar_bonus", pessoaId: r.pessoa.id, competencia: r.competencia })}>Aprovar bônus e registrar no RH</button>}
        </section>
        {dados.contexto.avaliar && !propria && <AvaliacaoLiderForm key={`${r.pessoa.id}-${r.competencia}`} pessoaId={r.pessoa.id} hoje={dados.contexto.hoje} acao={acao} salvando={salvando} />}
        <section className="cartao space-y-3"><h2 className="font-semibold">Avaliações da liderança</h2><p className="text-sm text-zinc-500">A média mensal usa as avaliações diárias dos dias elegíveis. O fechamento semanal orienta a evolução, sem pontuar o mesmo fato duas vezes.</p>{r.avaliacoes.length ? r.avaliacoes.map((a) => <article key={a.id} className="border-t border-zinc-200 pt-3"><p className="text-sm font-semibold">{a.data.split("-").reverse().join("/")} · {a.tipo === "DIARIA" ? "Diária" : "Semanal"} · {(Object.values(a.notas).reduce((t, n) => t + n, 0) / 4).toFixed(1)}/5</p><p className="whitespace-pre-wrap text-sm text-zinc-500">{a.comentario || "Sem observações."}</p></article>) : <p className="text-sm text-zinc-500">Sem avaliações neste período.</p>}</section>
      </>}
      {r && aba === "presenca" && <PresencaPainel key={`${r.pessoa.id}-${r.competencia}`} resumo={r} contexto={dados.contexto} acao={acao} salvando={salvando} />}
      {r && aba === "adesao" && <AdesaoPainel key={r.pessoa.id} dados={dados} resumo={r} acao={acao} salvando={salvando} />}
      {aba === "regras" && dados.contexto.dono && <ProgramaForm key={dados.regras[0]?.id ?? "novo"} regras={dados.regras} hoje={dados.contexto.hoje} acao={acao} salvando={salvando} />}
    </>}
  </div>;
}
