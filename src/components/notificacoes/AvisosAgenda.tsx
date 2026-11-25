"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/cliente-api";
import { acompanharAgenda } from "@/lib/agenda/acompanhar";
import type { NotificacaoDto, PainelNotificacoes } from "@/lib/notificacoes/tipos";

export function AvisosAgenda() {
  const [aviso, setAviso] = useState<NotificacaoDto | null>(null);
  useEffect(() => {
    let vivo = true, buscando = false;
    const desde = Date.now();
    const vistos = new Set<string>();
    async function atualizar() {
      if (buscando) return;
      buscando = true;
      try {
        const painel = await api<PainelNotificacoes>("/api/notificacoes");
        if (!vivo) return;
        const novos = painel.itens.filter(n => n.categoria === "EQUIPE" && n.titulo === "Novo agendamento"
          && !n.lidaEm && Date.parse(n.criadoEm) >= desde && !vistos.has(n.id));
        for (const n of novos) vistos.add(n.id);
        if (novos.length) {
          setAviso(novos[0]);
          window.dispatchEvent(new Event("black:notificacoes"));
        }
      } catch { /* O aviso persistido pode ser lido na central ao reconectar. */ }
      finally { buscando = false; }
    }
    const parar = acompanharAgenda(() => { void atualizar(); });
    return () => { vivo = false; parar(); };
  }, []);
  if (!aviso) return null;
  return <aside role="status" className="fixed bottom-24 left-4 right-4 z-50 mx-auto flex max-w-lg items-center gap-4 rounded-xl border border-ouro bg-white p-4 text-zinc-900 shadow-xl">
    <Link href={aviso.href} onClick={() => setAviso(null)} className="flex-1 rounded focus-visible:ring-2 focus-visible:ring-ouro">
      <strong className="block">{aviso.titulo}</strong><span className="text-sm">{aviso.corpo}</span>
    </Link>
    <button className="btn" aria-label="Fechar aviso de novo agendamento" onClick={() => setAviso(null)}>Fechar</button>
  </aside>;
}
