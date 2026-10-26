/** Logo no estilo da marca: monograma dourado com a primeira palavra + nome (wordmark do design system). */
export function Marca({ nome, tamanho = "md" }: { nome: string; tamanho?: "md" | "lg" }) {
  const primeira = (nome.trim().split(/\s+/)[0] ?? "").toUpperCase().slice(0, 6);
  const g = tamanho === "lg";
  return (
    <span className="flex shrink-0 items-center gap-2.5">
      <span
        className={`flex items-center justify-center rounded-[10px] border border-ouro/50 bg-[linear-gradient(180deg,rgb(211_171_69/22%),rgb(24_23_20/60%))] font-extrabold tracking-tight text-ouro-claro shadow-[inset_0_1px_0_rgb(255_244_195/14%),0_2px_6px_rgb(0_0_0/40%)] ${g ? "h-14 w-14 text-[11px]" : "h-9 w-9 text-[8px]"}`}
        aria-hidden="true"
      >
        {primeira}
      </span>
      <span className={`font-semibold tracking-[-0.02em] text-zinc-900 ${g ? "text-xl" : "text-[15px]"}`}>{nome}</span>
    </span>
  );
}
