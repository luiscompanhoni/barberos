"use client";
import { useRef, useState } from "react";
import { api } from "@/lib/cliente-api";

async function preparar(file: File) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 15 * 1024 * 1024) throw new Error("Escolha uma foto JPEG, PNG ou WebP de até 15 MB.");
  const url = URL.createObjectURL(file);
  try {
    const img = new Image(); img.src = url; await img.decode();
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 320;
    const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("Não foi possível preparar a foto.");
    const lado = Math.min(img.naturalWidth, img.naturalHeight);
    ctx.drawImage(img, (img.naturalWidth - lado) / 2, (img.naturalHeight - lado) / 2, lado, lado, 0, 0, 320, 320);
    return canvas.toDataURL("image/webp", 0.85);
  } finally { URL.revokeObjectURL(url); }
}
export function FotoPerfil({ versaoInicial, nome }: { versaoInicial: number; nome: string }) {
  const [versao, setVersao] = useState(versaoInicial), [ocupado, setOcupado] = useState(false), [mensagem, setMensagem] = useState("");
  const input = useRef<HTMLInputElement>(null), trava = useRef(false);
  async function alterar(file?: File) {
    if (trava.current) return;
    trava.current = true; setOcupado(true); setMensagem("");
    try {
      const r = await api<{ fotoVersao: number }>("/api/cliente/foto", file ? { method: "PUT", body: { dataUrl: await preparar(file) } } : { method: "DELETE" });
      setVersao(r.fotoVersao); setMensagem(file ? "Foto salva." : "Foto removida.");
    } catch (e) { setMensagem((e as Error).message); }
    finally { trava.current = false; setOcupado(false); }
  }
  return <div className="cartao flex flex-wrap items-center gap-3">
    {versao > 0 ? /* eslint-disable-next-line @next/next/no-img-element -- endpoint autenticado sem otimização pública */
      <img src={`/api/cliente/foto?v=${versao}`} alt={`Foto de ${nome}`} width={64} height={64} className="h-16 w-16 rounded-full object-cover" />
      : <span className="flex h-16 w-16 items-center justify-center rounded-full bg-zinc-100 text-xl" aria-hidden="true">{nome.slice(0, 1)}</span>}
    <div><p className="rotulo">Foto de perfil (opcional)</p><button type="button" className="btn" disabled={ocupado} onClick={() => input.current?.click()}>{ocupado ? "Salvando…" : "Escolher foto"}</button></div>
    {versao > 0 && <button type="button" className="btn" disabled={ocupado} onClick={() => void alterar()}>Remover</button>}
    <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" aria-label="Escolher foto de perfil" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void alterar(f); }} />
    <p className="w-full text-xs text-zinc-500" role="status">{mensagem || "Você pode continuar sem adicionar uma foto."}</p>
  </div>;
}
