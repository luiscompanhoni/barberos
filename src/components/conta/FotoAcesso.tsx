"use client";

import { useRef, useState } from "react";
import { FotoBarbeiro } from "@/components/FotoBarbeiro";
import { api } from "@/lib/cliente-api";
import type { Acesso } from "./acessos-tipos";

async function preparar(arquivo: File) {
  if (arquivo.size > 15 * 1024 * 1024) throw new Error("Escolha uma foto de até 15 MB.");
  const url = URL.createObjectURL(arquivo);
  try {
    const img = new Image(); img.src = url; await img.decode();
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 320;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Não foi possível preparar a foto.");
    const lado = Math.min(img.naturalWidth, img.naturalHeight);
    ctx.drawImage(img, (img.naturalWidth - lado) / 2, (img.naturalHeight - lado) / 2, lado, lado, 0, 0, 320, 320);
    return canvas.toDataURL("image/webp", 0.85);
  } finally { URL.revokeObjectURL(url); }
}

export function FotoAcesso({ acesso }: { acesso: Acesso }) {
  const arquivo = useRef<HTMLInputElement>(null);
  const [versao, setVersao] = useState(acesso.barbeiro?.fotoVersao ?? 0);
  const [ocupado, setOcupado] = useState(false);
  const [mensagem, setMensagem] = useState("");
  const b = acesso.barbeiro;
  if (!b) return null;
  async function enviar(file?: File) {
    if (!file || !b) return;
    setOcupado(true); setMensagem("");
    try {
      const r = await api<{ fotoVersao: number }>(`/api/barbeiros/${b.id}/foto`, { method: "PUT", body: { dataUrl: await preparar(file) } });
      setVersao(r.fotoVersao); setMensagem("Foto salva.");
    } catch (e) { setMensagem((e as Error).message); }
    finally { setOcupado(false); }
  }
  async function remover() {
    if (!b) return;
    setOcupado(true);
    try {
      const r = await api<{ fotoVersao: number }>(`/api/barbeiros/${b.id}/foto`, { method: "DELETE" });
      setVersao(r.fotoVersao); setMensagem("Foto removida.");
    } catch (e) { setMensagem((e as Error).message); }
    finally { setOcupado(false); }
  }
  return <div className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-200 p-3">
    <FotoBarbeiro id={b.id} nome={acesso.nome} cor={b.cor} versao={versao} tamanho={44} />
    <button type="button" className="btn" disabled={ocupado} onClick={() => arquivo.current?.click()}>{ocupado ? "Salvando…" : "Trocar foto"}</button>
    {versao > 0 && <button type="button" className="btn" disabled={ocupado} onClick={remover}>Remover foto</button>}
    <input ref={arquivo} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" aria-label="Foto do profissional" onChange={(e) => { void enviar(e.target.files?.[0]); e.target.value = ""; }} />
    <p className="w-full text-xs text-zinc-500" role="status">{mensagem || "A foto é salva ao escolher o arquivo e aparece na agenda e na área do cliente."}</p>
  </div>;
}
