"use client";

import { useState } from "react";
import Link from "next/link";
import { calendarioConteudo, filtrarCalendarioConteudo, type ItemCalendarioConteudo } from "@/lib/estudio/calendario-conteudo";

const dataBr = (data: string) => `${data.slice(8, 10)}/${data.slice(5, 7)}`;

export function CalendarioConteudoTela() {
  const [data, setData] = useState("");
  const [tema, setTema] = useState("");
  const [condicional, setCondicional] = useState<"todos" | "sim" | "nao">("todos");
  const itens = filtrarCalendarioConteudo(calendarioConteudo.itens, { data, tema, condicional });
  return <div className="space-y-4">
    <header className="crm-page-header"><p className="eyebrow">Black Barber · conteúdo para clientes</p>
      <h1 className="titulo-marca text-2xl">Calendário de novembro de 2026</h1>
      <p className="text-sm text-zinc-500">08/11: preparação interna. 09–30/11: 22 roteiros para revisão de Ygor.</p>
      <Link href="/campanhas" className="text-sm underline">Voltar às campanhas</Link></header>
    <section className="cartao space-y-2 text-sm" aria-label="Estado do planejamento">
      <p>{calendarioConteudo.aviso}</p>
      <p className="font-semibold">Estado: preparado para revisão. Este calendário não publica, agenda ou impulsiona conteúdo.</p>
      <p className="text-amber-800">Indicação: as peças de 16 e 24/11 continuam bloqueadas para divulgação até comprovar implementação e homologação das regras. O calendário não ativa o programa.</p>
      <p className="text-xs text-zinc-500">Fonte: documento editorial de 08/11/2026, versão revisável. Sincronização manual com o Markdown original; não há integração com redes sociais.</p>
    </section>
    <details className="cartao"><summary className="cursor-pointer font-semibold">Direção, fontes e revisão antes de publicar</summary>
      {[ ["Direção e fontes", calendarioConteudo.direcaoFontes], ["Captação e operação editorial", calendarioConteudo.captacaoOperacao],
        ["Fechamento editorial e aprendizado", calendarioConteudo.fechamentoEditorial] ].map(([titulo, texto]) =>
        <div key={titulo} className="mt-4"><h2 className="mb-2 font-semibold">{titulo}</h2><p className="whitespace-pre-wrap text-sm leading-relaxed">{texto}</p></div>)}
    </details>
    <section className="cartao grid gap-3 sm:grid-cols-3" aria-label="Filtros do calendário">
      <label className="rotulo">Data<select className="campo" value={data} onChange={(evento) => setData(evento.target.value)}><option value="">Todas as datas</option>
        {calendarioConteudo.itens.map((item) => <option key={item.data} value={item.data}>{dataBr(item.data)}</option>)}</select></label>
      <label className="rotulo">Tema<input className="campo" type="search" value={tema} onChange={(evento) => setTema(evento.target.value)} placeholder="Plano, app, indicação…" /></label>
      <label className="rotulo">Condição específica<select className="campo" value={condicional} onChange={(evento) => setCondicional(evento.target.value as typeof condicional)}>
        <option value="todos">Todos</option><option value="sim">Com dependência explícita</option><option value="nao">Sem dependência específica</option></select></label>
      <p className="text-xs text-zinc-500 sm:col-span-3">Todos os itens exigem revisão final. “Com dependência” destaca as condições específicas escritas no roteiro; não é autorização de publicação dos demais.</p>
    </section>
    <p className="text-sm text-zinc-500" role="status">{itens.length} item(ns) no filtro. Expanda uma data para ler o conteúdo integral.</p>
    {itens.length === 0 && <p className="cartao text-sm">Nenhum tema corresponde a esses filtros.</p>}
    <div className="space-y-3">{itens.map((item) => <DetalhesConteudo key={item.data} item={item} />)}</div>
  </div>;
}

function DetalhesConteudo({ item }: { item: ItemCalendarioConteudo }) {
  const campos = [["Gancho", item.gancho], ["Roteiro integral", item.roteiro], ["Cenas/texto", item.cenas],
    [item.legendaRotulo ?? "Legenda", item.legenda], ["CTA", item.cta], ["Stories", item.stories], ["Responsável/estado original", item.responsavelEstado]];
  return <details className="cartao">
    <summary className="cursor-pointer space-y-1"><span className="font-semibold">{dataBr(item.data)} · {item.tema}</span>
      <span className="block text-xs text-zinc-500">{item.tipo === "INTERNO" ? "Preparação interna · sem publicação prevista" : "Preparado para revisão"}
        {item.bloqueadoDivulgacao ? " · bloqueado para divulgação" : item.condicional ? " · depende de conferência" : ""}</span></summary>
    {item.tipo === "INTERNO" ? <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{item.textoOriginal}</p> :
      <dl className="mt-4 space-y-4">{campos.map(([rotulo, conteudo]) => <div key={rotulo}><dt className="font-semibold">{rotulo}</dt>
        <dd className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{conteudo}</dd></div>)}</dl>}
  </details>;
}
