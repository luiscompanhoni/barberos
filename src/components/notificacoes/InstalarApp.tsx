"use client";

import { useState, useSyncExternalStore } from "react";
import { Check, Download, Share } from "lucide-react";
import { assinarInstalacao, estadoInstalacao, estadoInstalacaoServidor, instalarApp } from "@/lib/pwa/instalacao";

export function InstalarApp({ area }: { area: "cliente" | "equipe" }) {
  const estado = useSyncExternalStore(assinarInstalacao, estadoInstalacao, estadoInstalacaoServidor);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  async function instalar() {
    setOcupado(true); setErro("");
    try { await instalarApp(); } catch { setErro("Não foi possível abrir a instalação. Tente pelo menu do navegador."); }
    finally { setOcupado(false); }
  }
  const nome = area === "cliente" ? "Black Barber" : "Black Barber Equipe";
  return <section className="cartao space-y-3" aria-labelledby="instalar-app-titulo">
    <h2 id="instalar-app-titulo" className="flex items-center gap-2 font-semibold"><Download size={18} aria-hidden="true" /> {nome} no seu aparelho</h2>
    {!estado.carregado ? <p className="text-sm text-zinc-500">Verificando instalação…</p>
      : estado.instalado ? <p className="flex items-center gap-2 text-sm text-emerald-700"><Check size={16} aria-hidden="true" /> Aplicativo instalado.</p>
        : !estado.seguro ? <p className="text-sm text-zinc-500">Abra o endereço seguro da Black Barber para instalar o aplicativo.</p>
          : estado.ios ? <div className="space-y-2 text-sm text-zinc-600">
            <p>No iPhone ou iPad, abra esta página no Safari.</p>
            <p>Toque em <Share className="inline" size={16} aria-hidden="true" /> <strong>Compartilhar</strong>, escolha <strong>Adicionar à Tela de Início</strong> e confirme em <strong>Adicionar</strong>.</p>
            <p>Depois, abra pelo ícone instalado. Notificações exigem iOS ou iPadOS 16.4 ou posterior.</p>
          </div>
            : estado.podeInstalar ? <button className="btn-primario focus-visible:ring-2 focus-visible:ring-ouro" disabled={ocupado} onClick={instalar}>{ocupado ? "Abrindo instalação…" : "Instalar aplicativo"}</button>
              : <p className="text-sm text-zinc-600">Abra o menu do navegador e procure “Instalar aplicativo” ou “Adicionar à tela inicial”. Se a opção não aparecer, continue usando o sistema pelo navegador ou tente Chrome/Edge atualizado.</p>}
    {estado.recusado && !estado.instalado && <p className="text-sm text-zinc-500">A instalação foi dispensada. Você pode instalar depois pelo menu do navegador.</p>}
    {erro && <p role="alert" className="text-sm text-red-600">{erro}</p>}
  </section>;
}
