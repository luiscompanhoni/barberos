"use client";

import { useEffect, useState } from "react";
import { Star, ShieldCheck } from "lucide-react";
import { api } from "@/lib/cliente-api";
import { ConfiguracaoAvaliacoes } from "./ConfiguracaoAvaliacoes";

type Resumo = { barbeiroId: string; nome: string; media: number | null; quantidade: number; faixa: string; emFormacao: boolean; categorias: { chave: string; media: number | null }[] };
type Linha = { id: string; nota: number; criadoEm: string; convite: { barbeiro: { nome: string } } };
type Painel = { resumos: Resumo[]; avaliacoes: Linha[]; dono: boolean };
type Detalhe = { id: string; cliente: string; barbeiro: string; nota: number; comentario: string | null; criadoEm: string; corte: number | null; atendimento: number | null; ambiente: number | null; pontualidade: number | null };
const CORES: Record<string, string> = { excelente: "text-emerald-700", atencao: "text-amber-700", melhorar: "text-red-600", formacao: "text-zinc-500" };
const ROTULOS: Record<string, string> = { excelente: "Excelente", atencao: "Acompanhar", melhorar: "Melhorar", formacao: "Em formação" };

export function AvaliacoesTela() {
  const [painel, setPainel] = useState<Painel | null>(null);
  const [erro, setErro] = useState("");
  const [detalhe, setDetalhe] = useState<Detalhe | null>(null);
  const [abrindo, setAbrindo] = useState(false);
  useEffect(() => {
    let ativa = true;
    api<Painel>("/api/avaliacoes").then(r => { if (ativa) setPainel(r); }).catch(e => { if (ativa) setErro(e.message); });
    return () => { ativa = false; };
  }, []);
  async function consultar(id: string) {
    setAbrindo(true); setErro(""); setDetalhe(null);
    try { setDetalhe(await api<Detalhe>(`/api/avaliacoes/${id}`)); }
    catch (e) { setErro((e as Error).message); }
    finally { setAbrindo(false); }
  }
  return <main className="space-y-5"><div><p className="eyebrow">Qualidade do atendimento</p><h1 className="titulo-marca">Avaliações dos clientes</h1></div>
    <p className="flex items-start gap-2 text-sm text-zinc-600"><ShieldCheck className="shrink-0" size={18} />Médias publicadas em grupos de pelo menos 5 clientes. A atualização não acontece a cada resposta. A nota do cliente é independente da avaliação do líder.</p>
    {erro && <p role="alert" className="text-red-600">{erro}</p>}
    {!painel && !erro && <p role="status">Carregando avaliações…</p>}
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{painel?.resumos.map(r => <section key={r.barbeiroId} className="cartao space-y-3"><h2 className="font-semibold">{r.nome}</h2><div className={`flex items-center gap-2 ${CORES[r.faixa]}`}><Star aria-hidden size={24} /><span className="text-3xl font-semibold">{r.media === null ? "—" : r.media.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 2 })}</span><span>/ 5 · {ROTULOS[r.faixa]}</span></div>
      <p className="text-sm text-zinc-600">{r.emFormacao ? "Ainda sem avaliações suficientes." : `${r.quantidade} avaliações publicadas · acumulado desde a ativação`}</p>
      <dl className="space-y-1 text-sm">{r.categorias.map(c => <div className="flex justify-between gap-2" key={c.chave}><dt className="capitalize">{c.chave}</dt><dd>{c.media === null ? "Base insuficiente" : `${c.media.toLocaleString("pt-BR")} / 5`}</dd></div>)}</dl>
    </section>)}</div>
    {painel?.dono && <><ConfiguracaoAvaliacoes /><section className="cartao space-y-3"><h2 className="font-semibold">Consulta reservada ao dono</h2><p className="text-sm text-zinc-600">Cada abertura da identidade fica registrada na auditoria. As 100 avaliações mais recentes aparecem abaixo.</p>
      {painel.avaliacoes.length === 0 && <p className="text-sm">Nenhuma avaliação recebida.</p>}
      <div className="max-h-72 overflow-auto"><ul className="divide-y divide-zinc-200">{painel.avaliacoes.map(a => <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-3"><span>{a.convite.barbeiro.nome} · {a.nota}/5 · {new Date(a.criadoEm).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}</span><button className="btn text-sm" disabled={abrindo} onClick={() => consultar(a.id)}>Consultar identidade e comentário</button></li>)}</ul></div>
      {abrindo && <p role="status">Registrando consulta…</p>}
      {detalhe && <div className="cartao-destaque space-y-2 p-4"><div className="flex justify-between gap-3"><h3 className="font-semibold">{detalhe.cliente} · {detalhe.nota}/5</h3><button className="btn" onClick={() => setDetalhe(null)}>Fechar dados</button></div><p className="text-sm">Atendido por {detalhe.barbeiro}</p><p className="whitespace-pre-wrap text-sm">{detalhe.comentario || "Sem comentário."}</p></div>}
    </section></>}
  </main>;
}
