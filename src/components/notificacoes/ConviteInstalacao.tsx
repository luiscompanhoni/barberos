"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Download, Share } from "lucide-react";
import { assinarInstalacao, estadoInstalacao, estadoInstalacaoServidor, instalarApp } from "@/lib/pwa/instalacao";
import { registrarApp } from "@/lib/pwa/push-cliente";

/** Convite discreto para instalar o atalho; nenhum prompt é aberto sem clique. */
export function ConviteInstalacao() {
  const estado = useSyncExternalStore(assinarInstalacao, estadoInstalacao, estadoInstalacaoServidor);
  const [erro, setErro] = useState("");
  useEffect(() => {
    if (window.isSecureContext && "serviceWorker" in navigator) void registrarApp().catch(() => {});
  }, []);
  if (!estado.carregado || estado.instalado || !estado.seguro) return null;

  async function instalar() {
    setErro("");
    try { await instalarApp(); }
    catch { setErro("Não foi possível abrir a instalação. Use o menu do navegador."); }
  }

  return <aside className="mt-6 max-w-xl rounded-xl border border-ouro/40 bg-fundo/80 p-4 text-sm backdrop-blur" aria-label="Instalar aplicativo Black Barber">
    <p className="font-semibold text-zinc-900">Tenha a Black na tela inicial</p>
    {estado.ios
      ? <p className="mt-1 text-zinc-500">No Safari, toque em <Share size={14} className="inline" aria-hidden="true" /> Compartilhar → Adicionar à Tela de Início.</p>
      : estado.podeInstalar
        ? <button type="button" className="mt-2 inline-flex items-center gap-2 font-semibold text-ouro underline focus-visible:ring-2 focus-visible:ring-ouro" onClick={instalar}><Download size={16} aria-hidden="true" /> Instalar aplicativo</button>
        : <p className="mt-1 text-zinc-500">No menu do navegador, escolha “Instalar aplicativo” ou “Adicionar à tela inicial”.</p>}
    {erro && <p role="alert" className="mt-2 text-red-600">{erro}</p>}
  </aside>;
}
