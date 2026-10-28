"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Bell, CheckCheck, RefreshCw } from "lucide-react";
import { api } from "@/lib/cliente-api";
import type { PainelNotificacoes } from "@/lib/notificacoes/tipos";
import { destinoNotificacao } from "@/lib/pwa/urls";
import { InstalarApp } from "./InstalarApp";
import { PushAvisos } from "./PushAvisos";
import { PreferenciasAvisos } from "./PreferenciasAvisos";

export function CentralNotificacoes({ area }: { area: "cliente" | "equipe" }) {
  const [dados, setDados] = useState<PainelNotificacoes | null>(null);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [mensagem, setMensagem] = useState("");
  const carregar = useCallback(async () => {
    setDados(await api<PainelNotificacoes>("/api/notificacoes"));
    setErro(""); window.dispatchEvent(new Event("black:notificacoes"));
  }, []);
  useEffect(() => {
    let vivo = true;
    api<PainelNotificacoes>("/api/notificacoes").then(d => { if (vivo) { setDados(d); setErro(""); } }).catch(e => vivo && setErro(e.message));
    return () => { vivo = false; };
  }, []);
  async function atualizar() {
    setOcupado(true); setMensagem("");
    try { await carregar(); setMensagem("Avisos atualizados."); } catch (e) { setErro((e as Error).message); }
    finally { setOcupado(false); }
  }
  async function marcarLida(id: string) {
    setOcupado(true); setErro(""); setMensagem("");
    try {
      await api(`/api/notificacoes/${encodeURIComponent(id)}`, { method: "PATCH" });
      await carregar(); setMensagem("Aviso marcado como lido.");
    } catch (e) { setErro((e as Error).message); } finally { setOcupado(false); }
  }
  return <div className="space-y-5">
    <header className="flex flex-wrap items-start gap-3">
      <div className="min-w-0 flex-1"><p className="eyebrow">Sua conta</p><h1 className="titulo-marca mt-1 text-3xl">Notificações</h1><p className="mt-2 text-sm text-zinc-500">Seus avisos, preferências e aparelhos.</p></div>
      <button className="btn focus-visible:ring-2 focus-visible:ring-ouro" disabled={ocupado} onClick={() => void atualizar()}><RefreshCw size={16} aria-hidden="true" /> Atualizar</button>
    </header>
    <InstalarApp area={area} />
    {erro && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</p>}
    {!dados && !erro && <p role="status" className="text-sm text-zinc-500">Carregando avisos…</p>}
    {dados && <>
      <section className="cartao space-y-3" aria-labelledby="avisos-lista-titulo">
        <h2 id="avisos-lista-titulo" className="flex items-center gap-2 font-semibold"><Bell size={18} aria-hidden="true" /> Seus avisos <span className="text-xs font-normal text-zinc-500">{dados.naoLidas} não lido(s)</span></h2>
        {!dados.itens.length ? <p className="py-3 text-sm text-zinc-500">Nenhum aviso por enquanto.</p> : <ul className="divide-y divide-zinc-200">{dados.itens.map(n => <li key={n.id} className="space-y-2 py-4">
          <div className="flex items-start gap-2"><h3 className="min-w-0 flex-1 break-words text-sm font-semibold">{n.titulo}</h3>{!n.lidaEm && <span className="selo-ouro shrink-0">Novo</span>}</div>
          <p className="break-words text-sm text-zinc-600">{n.corpo}</p>
          <time className="block text-xs text-zinc-500" dateTime={n.criadoEm}>{new Date(n.criadoEm).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })}</time>
          <div className="flex flex-wrap gap-2"><Link className="btn focus-visible:ring-2 focus-visible:ring-ouro" href={destinoNotificacao(n.href, area)}>Abrir aviso</Link>
            {!n.lidaEm && <button className="btn focus-visible:ring-2 focus-visible:ring-ouro" disabled={ocupado} onClick={() => void marcarLida(n.id)}><CheckCheck size={14} aria-hidden="true" /> Marcar como lido</button>}
          </div>
        </li>)}</ul>}
        <p role="status" className="text-sm text-zinc-500">{ocupado ? "Atualizando…" : mensagem}</p>
      </section>
      <PushAvisos dados={dados} onAlterado={carregar} />
      <PreferenciasAvisos area={area} preferencias={dados.preferencias} onSalvo={carregar} />
    </>}
  </div>;
}
