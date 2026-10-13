/** Logo no estilo da marca: anel dourado com a primeira palavra + nome em caixa alta. */
export function Marca({ nome, tamanho = "md" }: { nome: string; tamanho?: "md" | "lg" }) {
  const primeira = (nome.trim().split(/\s+/)[0] ?? "").toUpperCase().slice(0, 6);
  const g = tamanho === "lg";
  return (
    <span className="flex shrink-0 items-center gap-2.5">
      <span
        className={`flex items-center justify-center rounded-full border-2 border-ouro bg-black font-black tracking-tight text-zinc-950 ${g ? "h-14 w-14 text-[11px]" : "h-9 w-9 text-[8px]"}`}
        aria-hidden="true"
      >
        {primeira}
      </span>
      <span className={`font-black tracking-[0.08em] text-zinc-900 uppercase ${g ? "text-lg" : "text-sm"}`}>{nome}</span>
    </span>
  );
}
