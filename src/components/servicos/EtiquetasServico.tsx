import { etiquetasDoServico, raioDaEtiqueta, textoDaEtiqueta } from "@/lib/servicos/etiquetas";

/** A mesma etiqueta na edição e no catálogo; somente texto e estilos validados. */
export function EtiquetasServico({ etiquetas }: { etiquetas: unknown }) {
  const itens = etiquetasDoServico(etiquetas);
  if (!itens.length) return null;
  return <span className="mt-2 flex flex-wrap gap-1.5">
    {itens.map((item, i) => <span key={i} className="inline-block max-w-full break-words px-2 py-1 text-[11px] leading-tight font-bold"
      style={{ backgroundColor: item.cor, color: textoDaEtiqueta(item.cor), borderRadius: raioDaEtiqueta(item.formato) }}>{item.texto}</span>)}
  </span>;
}
