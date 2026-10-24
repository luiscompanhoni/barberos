"use client";
import { useState, type FormEvent } from "react";
import { SERVICOS } from "@/lib/recrutamento/regras";
type Vaga = { id: string; titulo: string; cidade: string; descricao: string; privacidade: string };
export function FormularioCandidatura({ vaga }: { vaga: Vaga }) {
  const [erro, setErro] = useState(""); const [enviando, setEnviando] = useState(false);
  const [recebido, setRecebido] = useState(false); const [envioId, setEnvioId] = useState<string | null>(null);
  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setErro(""); setEnviando(true);
    const f = new FormData(e.currentTarget); const id = envioId ?? crypto.randomUUID(); setEnvioId(id);
    const busca = new URLSearchParams(window.location.search);
    const origem = Object.fromEntries(["utm_source", "utm_medium", "utm_campaign", "utm_content"].flatMap((k) => busca.has(k) ? [[k, busca.get(k)!.slice(0, 150)]] : []));
    try {
      const r = await fetch(`/api/recrutamento/publico/${vaga.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        envioId: id, nome: f.get("nome"), telefone: f.get("telefone"), cidade: f.get("cidade"), experienciaMeses: Number(f.get("experienciaMeses")),
        servicos: f.getAll("servicos"), disponibilidade: f.get("disponibilidade"), portfolio: f.get("portfolio"), instagram: f.get("instagram"),
        cienciaPrivacidade: f.get("cienciaPrivacidade") === "on", futurasOportunidades: f.get("futurasOportunidades") === "on", origem,
      }) });
      const b = await r.json(); if (!r.ok) throw new Error(b.erro ?? "Não foi possível enviar."); setRecebido(true);
    } catch (e) { setErro((e as Error).message); } finally { setEnviando(false); }
  }
  if (recebido) return <section className="cartao space-y-3" role="status"><h1 className="titulo-marca text-2xl">Candidatura recebida</h1><p>A gestão da Black Barber vai analisar seu cadastro. O envio não garante entrevista ou contratação.</p></section>;
  return <div className="space-y-5">
    <header><p className="eyebrow">Faça parte da Black</p><h1 className="titulo-marca text-3xl">{vaga.titulo}</h1><p className="text-ouro">{vaga.cidade}</p></header>
    <section className="cartao whitespace-pre-wrap">{vaga.descricao}</section>
    <form onSubmit={enviar} className="cartao space-y-4">
      <h2 className="text-xl font-semibold">Sua candidatura</h2><p className="text-sm text-zinc-500">Preencha seus dados profissionais. Portfólio e Instagram são opcionais.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <label>Nome<input name="nome" className="campo" required minLength={2} maxLength={120} autoComplete="name" /></label>
        <label>WhatsApp<input name="telefone" className="campo" required maxLength={30} type="tel" autoComplete="tel" /></label>
        <label>Cidade<input name="cidade" className="campo" required minLength={2} maxLength={100} autoComplete="address-level2" /></label>
        <label>Experiência na profissão (meses)<input name="experienciaMeses" className="campo" type="number" required min={0} max={720} step={1} /></label>
      </div>
      <fieldset><legend className="mb-2">Quais serviços você realiza?</legend><div className="grid gap-3 sm:grid-cols-2">{SERVICOS.map((s) => <label key={s} className="flex min-h-11 items-center gap-2"><input type="checkbox" name="servicos" value={s} />{s}</label>)}</div></fieldset>
      <label className="block">Dias, horários disponíveis e quando pode começar<textarea name="disponibilidade" className="campo" required minLength={2} maxLength={1000} rows={3} /></label>
      <label className="block">Link do portfólio (opcional)<input name="portfolio" className="campo" type="url" maxLength={500} placeholder="https://..." /></label>
      <label className="block">Link do Instagram profissional (opcional)<input name="instagram" className="campo" type="url" maxLength={500} placeholder="https://www.instagram.com/..." /></label>
      <p className="text-sm text-zinc-500">Links servem como amostras do seu trabalho. Seguidores e aparência não são critérios de seleção.</p>
      <section className="rounded-xl border border-zinc-500/20 p-4 text-sm whitespace-pre-wrap">{vaga.privacidade}</section>
      <label className="flex gap-3 items-start"><input type="checkbox" name="cienciaPrivacidade" required className="mt-1" /><span>Li o aviso sobre o uso dos meus dados nesta seleção.</span></label>
      <label className="flex gap-3 items-start"><input type="checkbox" name="futurasOportunidades" className="mt-1" /><span>Também autorizo que meu cadastro seja considerado para futuras oportunidades (opcional).</span></label>
      {erro && <p role="alert" className="text-red-500">{erro} Confira os campos e selecione ao menos um serviço.</p>}
      <button className="btn-primario w-full min-h-12" disabled={enviando}>{enviando ? "Enviando…" : "Enviar candidatura"}</button>
    </form>
  </div>;
}
