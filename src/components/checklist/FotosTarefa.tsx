"use client";

import { useState } from "react";
import { Camera, ImagePlus } from "lucide-react";

type Foto = { id: string; dataUrl: string };

async function prepararFoto(arquivo: File): Promise<string> {
  if (!arquivo.type.startsWith("image/")) throw new Error("Escolha uma foto.");
  if (arquivo.size > 15 * 1024 * 1024) throw new Error("Escolha uma foto de até 15 MB.");
  const bitmap = await createImageBitmap(arquivo);
  try {
    const escala = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * escala));
    canvas.height = Math.max(1, Math.round(bitmap.height * escala));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Não foi possível preparar a foto.");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const foto = canvas.toDataURL("image/webp", 0.7);
    if (foto.length > 540_000) throw new Error("A foto ficou muito grande. Escolha uma imagem menor.");
    return foto;
  } finally { bitmap.close(); }
}

/** Evidências privadas, opcionais e separadas da conclusão/validação da tarefa. */
export function FotosTarefa({ itemId, token, quantidade, validada }: { itemId: string; token?: string; quantidade: number; validada: boolean }) {
  const [aberto, setAberto] = useState(false);
  const [fotos, setFotos] = useState<Foto[] | null>(null);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const url = `/api/checklist/fotos/${itemId}${token ? `?token=${encodeURIComponent(token)}` : ""}`;
  const total = fotos?.length ?? quantidade;

  async function carregar() {
    const r = await fetch(url, { cache: "no-store" });
    const d = await r.json();
    if (!r.ok) throw new Error(d.erro ?? "Não foi possível abrir as fotos.");
    setFotos(d.fotos);
  }
  async function enviar(arquivo?: File) {
    if (!arquivo || ocupado) return;
    setOcupado(true); setErro("");
    try {
      const dataUrl = await prepararFoto(arquivo);
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dataUrl }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.erro ?? "Não foi possível salvar a foto.");
      await carregar();
    } catch (e) { setErro((e as Error).message); }
    finally { setOcupado(false); }
  }
  return (
    <div className="px-2 pb-2 pl-7">
      <button type="button" className="inline-flex min-h-9 items-center gap-1.5 text-xs text-zinc-600 hover:text-ouro" aria-expanded={aberto}
        onClick={() => { setAberto(!aberto); if (!aberto) carregar().catch((e) => setErro(e.message)); }}>
        <Camera size={14} /> {total ? `${total} foto(s)` : "Adicionar foto (opcional)"}
      </button>
      {aberto && <div className="space-y-2 rounded-xl border border-zinc-200 bg-zinc-50 p-2">
        <p className="text-[11px] text-zinc-500">Até 3 fotos como evidência. A foto não marca nem valida a tarefa.</p>
        <div className="flex flex-wrap gap-2">
          {fotos?.map((f, i) => <a key={f.id} href={f.dataUrl} download={`tarefa-${itemId}-${i + 1}.webp`} title="Baixar foto">
            {/* Imagem privada carregada sob demanda; não passa pelo otimizador público. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={f.dataUrl} alt={`Evidência ${i + 1} da tarefa`} className="h-24 w-24 rounded-lg object-cover" />
          </a>)}
        </div>
        {!validada && total < 3 && <label className={`btn cursor-pointer text-xs ${ocupado ? "pointer-events-none opacity-50" : ""}`}>
          <ImagePlus size={14} /> {ocupado ? "Salvando foto…" : "Escolher ou tirar foto"}
          <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" className="sr-only" disabled={ocupado}
            onChange={(e) => { enviar(e.target.files?.[0]); e.target.value = ""; }} />
        </label>}
        {validada && <p className="text-[11px] text-zinc-500">Evidências preservadas: tarefa validada.</p>}
      </div>}
      {erro && <p role="alert" className="text-xs text-red-700">{erro}</p>}
    </div>
  );
}
