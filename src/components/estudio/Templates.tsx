"use client";

import { TEMPLATES, type Preset } from "@/lib/estudio/templates";

export function Templates({ valor, mudar, desabilitado = false, classico = false }: { valor: Preset; mudar: (id: Preset) => void; desabilitado?: boolean; classico?: boolean }) {
  return <fieldset disabled={desabilitado} className="min-w-0 space-y-3">
    <legend className="text-sm font-semibold">Template da Black</legend>
    <div className="grid gap-3 sm:grid-cols-3">{(Object.keys(TEMPLATES) as Preset[]).filter(id => classico || id !== "black-vertical-v1").map(id => {
      const t = TEMPLATES[id];
      return <label key={id} className={`min-w-0 cursor-pointer rounded-xl border p-3 ${valor === id ? "border-ouro bg-ouro/5" : "border-zinc-200"} ${desabilitado ? "opacity-60" : ""}`}>
        <div aria-hidden="true" className={`mb-3 flex min-h-36 flex-col justify-between rounded-lg bg-zinc-950 p-4 text-[#edd8a1] ${id === "black-equipe-v2" ? "font-serif" : "font-sans"}`}>
          <span className="text-[10px] tracking-[.3em]">BLACK</span><span className={`max-w-48 whitespace-pre-wrap text-lg leading-tight ${id === "black-recrutamento-v2" ? "border-l-2 border-[#c4a86a] pl-3 font-extrabold" : "font-medium"}`}>{t.titulo || "BLACK VERTICAL"}</span><span className="text-[9px] tracking-wider">{t.largura} × {t.altura} · 9:16</span>
        </div>
        <span className="flex items-start gap-2 text-sm font-semibold"><input type="radio" name="template-black" checked={valor === id} onChange={() => mudar(id)} className="mt-1 accent-amber-500" />{t.nome}</span>
        <span className="mt-2 block text-xs text-zinc-500">{t.descricao}</span>
      </label>;
    })}</div>
    <p className="text-xs text-zinc-500">Amostra de estilo. Os vídeos e os textos da montagem aparecem na prévia renderizada.</p>
  </fieldset>;
}
