"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Star, ShieldCheck } from "lucide-react";
import { api } from "@/lib/cliente-api";

type Convite = { id: string; respondida: boolean; expirada: boolean; barbeiro: string; expiraEm: string; recompensa: { jogoId: string; nome: string; validadeDias: number } | null };
const CATEGORIAS = [{ chave: "corte", rotulo: "Corte" }, { chave: "atendimento", rotulo: "Atendimento" }, { chave: "ambiente", rotulo: "Ambiente" }, { chave: "pontualidade", rotulo: "Pontualidade" }];

export function AvaliacaoCliente() {
  const [convite, setConvite] = useState<Convite | null>();
  const [nota, setNota] = useState(0);
  const [comentario, setComentario] = useState("");
  const [categorias, setCategorias] = useState<Record<string, number>>({});
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  useEffect(() => {
    let ativo = true;
    api<{ convite: Convite | null }>("/api/cliente/avaliacoes").then(r => { if (ativo) setConvite(r.convite); }).catch(e => { if (ativo) setErro(e.message); });
    return () => { ativo = false; };
  }, []);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!convite || !nota) return;
    setSalvando(true); setErro("");
    try {
      await api("/api/cliente/avaliacoes", { method: "POST", body: { conviteId: convite.id, nota, comentario, ...categorias } });
      setConvite({ ...convite, respondida: true });
    } catch (e) { setErro((e as Error).message); }
    finally { setSalvando(false); }
  }

  return <main className="space-y-5 p-4">
    <div><p className="eyebrow">Sua experiência importa</p><h1 className="titulo-marca">Como foi sua visita?</h1></div>
    <p className="cartao flex gap-3 text-sm"><ShieldCheck className="shrink-0 text-ouro" size={22} />Seu nome não será mostrado ao barbeiro. A administração autorizada pode consultar sua avaliação para melhorar o atendimento. Ela fica somente dentro da barbearia.</p>
    {erro && <p role="alert" className="text-sm text-red-600">{erro}</p>}
    {convite === undefined && !erro && <p role="status">Carregando sua avaliação…</p>}
    {convite === null && <div className="cartao">Seu convite aparecerá aqui após a primeira visita elegível à barbearia.</div>}
    {convite?.respondida && <div className="cartao space-y-3"><h2 className="font-semibold">Obrigado por contar sua experiência!</h2><p>Sua avaliação foi registrada.</p>{convite.recompensa && <><p>Uma jogada foi liberada em {convite.recompensa.nome}, com validade de {convite.recompensa.validadeDias} dias a partir da avaliação.</p><Link className="btn-primario" href={`/c/jogos/${convite.recompensa.jogoId}`}>Usar minha jogada</Link></>}</div>}
    {convite?.expirada && <p className="cartao">O prazo para esta avaliação terminou.</p>}
    {convite && !convite.respondida && !convite.expirada && <form onSubmit={enviar} className="cartao space-y-5">
      <p>Conte como foi seu atendimento com <strong>{convite.barbeiro}</strong>.</p>
      <fieldset><legend className="rotulo">Nota geral, de 1 a 5 estrelas</legend><div className="flex gap-2 pt-2">{[1, 2, 3, 4, 5].map(n => <label key={n} className="cursor-pointer rounded-lg border border-zinc-200 p-2 focus-within:ring-2 focus-within:ring-ouro"><input className="sr-only" type="radio" name="nota" value={n} checked={nota === n} onChange={() => setNota(n)} required aria-label={`${n} ${n === 1 ? "estrela" : "estrelas"}`} /><Star aria-hidden size={28} className={n <= nota ? "fill-ouro text-ouro" : "text-zinc-400"} /></label>)}</div><p className="mt-2 text-sm">{nota ? `${nota} de 5 estrelas` : "Escolha sua nota"}</p></fieldset>
      <div className="grid grid-cols-2 gap-3">{CATEGORIAS.map(c => <label className="rotulo" key={c.chave}>{c.rotulo} (opcional)<select className="campo mt-1" value={categorias[c.chave] ?? ""} onChange={e => setCategorias(atual => { const novo = { ...atual }; if (e.target.value) novo[c.chave] = Number(e.target.value); else delete novo[c.chave]; return novo; })}><option value="">Não avaliar</option>{[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n} de 5</option>)}</select></label>)}</div>
      <label className="rotulo block">Quer contar mais? (opcional)<textarea className="campo mt-1 min-h-24" maxLength={2000} value={comentario} onChange={e => setComentario(e.target.value)} placeholder="O que foi bom e o que podemos melhorar?" /></label>
      {convite.recompensa && <p className="text-sm text-ouro">Enviar sua avaliação libera uma jogada em {convite.recompensa.nome}. Qualquer nota vale: queremos ouvir sua opinião sincera.</p>}
      <button className="btn-primario w-full" disabled={salvando || !nota}>{salvando ? "Enviando…" : "Enviar avaliação"}</button>
    </form>}
  </main>;
}
