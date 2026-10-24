import Link from "next/link";
import { ArrowUpRight, Check, HeartHandshake, Sparkles } from "lucide-react";
import { MANDAMENTOS, OBJETIVO_CULTURA, ROTINAS, VERSAO_CULTURA_BLACK } from "@/lib/cultura-black/conteudo";

export function CulturaBlackTela({ hrefChecklist }: { hrefChecklist: string | null }) {
  return (
    <div className="mx-auto max-w-5xl space-y-8 pb-8">
      <header className="space-y-2">
        <p className="eyebrow">Equipe · versão {VERSAO_CULTURA_BLACK}</p>
        <h1 className="titulo-marca text-3xl sm:text-4xl">Cultura Black</h1>
        <p className="max-w-2xl text-sm leading-6 text-zinc-600">Um padrão claro para cuidar do cliente, do time e do lugar onde a gente cresce.</p>
      </header>

      <section className="relative overflow-hidden rounded-3xl border border-ouro/35 bg-[radial-gradient(ellipse_at_top_right,rgba(211,171,69,0.14),transparent_55%)] p-5 sm:p-8" aria-labelledby="objetivo-black">
        <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-ouro/30 bg-ouro/10 text-ouro"><Sparkles size={20} aria-hidden="true" /></div>
        <p className="eyebrow">Nosso objetivo</p>
        <h2 id="objetivo-black" className="mt-2 max-w-3xl text-2xl font-bold leading-tight text-zinc-900 sm:text-3xl">{OBJETIVO_CULTURA.titulo}</h2>
        <p className="mt-4 max-w-3xl text-sm leading-7 text-zinc-700">{OBJETIVO_CULTURA.texto}</p>
        <div className="mt-5 flex gap-3 rounded-2xl border border-zinc-200 bg-white/70 p-4 text-sm leading-6 text-zinc-700">
          <HeartHandshake className="mt-0.5 shrink-0 text-ouro" size={18} aria-hidden="true" />
          <p>{OBJETIVO_CULTURA.compromisso}</p>
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="mandamentos-black">
        <div>
          <p className="eyebrow">Como trabalhamos</p>
          <h2 id="mandamentos-black" className="titulo-marca mt-1 text-2xl">Dez mandamentos</h2>
          <p className="mt-1 text-sm text-zinc-600">Toque em um cartão para ver exemplos práticos.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {MANDAMENTOS.map((m) => (
            <details key={m.numero} className="group rounded-2xl border border-zinc-200 bg-white open:border-ouro/50 open:bg-zinc-50">
              <summary className="flex min-h-20 cursor-pointer list-none items-start gap-3 p-4 [&::-webkit-details-marker]:hidden">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-ouro/10 text-sm font-black text-ouro">{m.numero}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-bold leading-5 text-zinc-900">{m.titulo}</span>
                  <span className="mt-1 block text-sm leading-5 text-zinc-600">{m.resumo}</span>
                </span>
                <span aria-hidden="true" className="mt-1 text-zinc-500 transition-transform group-open:rotate-45">+</span>
              </summary>
              <div className="space-y-3 border-t border-zinc-200 px-4 pb-4 pt-3 text-sm leading-6 text-zinc-700">
                <p className="font-semibold text-zinc-900">Na prática</p>
                <ul className="space-y-2">
                  {m.pratica.map((passo) => <li key={passo} className="flex gap-2"><Check size={16} className="mt-1 shrink-0 text-ouro" aria-hidden="true" /><span>{passo}</span></li>)}
                </ul>
                <p className="rounded-xl bg-zinc-100 p-3"><b>Se algo impedir:</b> {m.limite}</p>
              </div>
            </details>
          ))}
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="rotinas-black">
        <div>
          <p className="eyebrow">No dia a dia</p>
          <h2 id="rotinas-black" className="titulo-marca mt-1 text-2xl">Três rotinas</h2>
          <p className="mt-1 text-sm text-zinc-600">A rotina orienta. O checklist existente continua sendo o lugar para acompanhar as tarefas.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {ROTINAS.map((rotina) => (
            <article key={rotina.id} className="flex flex-col rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5">
              <p className="text-xs font-bold uppercase tracking-wider text-ouro">{rotina.quando}</p>
              <h3 className="mt-1 text-lg font-bold text-zinc-900">{rotina.titulo}</h3>
              <ul className="mt-4 flex-1 space-y-3 text-sm leading-6 text-zinc-700">
                {rotina.passos.map((passo) => <li key={passo} className="flex gap-2"><Check size={16} className="mt-1 shrink-0 text-ouro" aria-hidden="true" /><span>{passo}</span></li>)}
              </ul>
              <p className="mt-4 rounded-xl bg-zinc-100 p-3 text-xs leading-5 text-zinc-600"><span className="font-semibold text-zinc-800">No checklist:</span> {rotina.tarefa}</p>
              {hrefChecklist ? (
                <Link href={hrefChecklist} className="mt-3 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-ouro/50 px-4 py-2 text-sm font-semibold text-ouro hover:bg-ouro/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ouro">
                  {hrefChecklist === "/checklist" ? "Abrir checklist da equipe" : "Abrir meu checklist"}<ArrowUpRight size={16} aria-hidden="true" />
                </Link>
              ) : (
                <p className="mt-3 rounded-xl border border-zinc-200 p-3 text-xs leading-5 text-zinc-600">Peça à liderança para vincular seu acesso ao checklist existente.</p>
              )}
            </article>
          ))}
        </div>
      </section>

      <p className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-sm leading-6 text-zinc-700">
        Se houver uma falha, a prioridade é corrigir o que for possível e conversar com respeito. A liderança deve entender o que aconteceu, ouvir quem está envolvido e remover impedimentos. Nenhuma ocorrência é exposta ou punida automaticamente por esta página.
      </p>
    </div>
  );
}
