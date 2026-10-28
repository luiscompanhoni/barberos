"use client";

import Link from "next/link";
import { Bell } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { PainelNotificacoes } from "@/lib/notificacoes/tipos";

export function SinoNotificacoes({ href }: { href: string; area?: "cliente" | "equipe" }) {
  const [quantidade, setQuantidade] = useState(0);
  const link = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    let vivo = true;
    let buscando = false;
    async function atualizar() {
      // O menu tem versões para computador e celular; só a visível consulta o contador.
      if (document.visibilityState === "hidden" || !link.current?.getClientRects().length || buscando) return;
      buscando = true;
      try {
        const resposta = await fetch("/api/notificacoes", { cache: "no-store" });
        if (!resposta.ok) return;
        const dados = await resposta.json() as PainelNotificacoes;
        if (vivo) setQuantidade(dados.naoLidas);
      } catch { /* A navegação continua disponível sem conexão. */ }
      finally { buscando = false; }
    }
    void atualizar();
    const timer = setInterval(atualizar, 60_000);
    window.addEventListener("focus", atualizar);
    window.addEventListener("black:notificacoes", atualizar);
    window.addEventListener("resize", atualizar);
    return () => { vivo = false; clearInterval(timer); window.removeEventListener("focus", atualizar); window.removeEventListener("black:notificacoes", atualizar); window.removeEventListener("resize", atualizar); };
  }, []);
  return <Link ref={link} className="relative inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg text-zinc-600 hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-ouro" href={href} aria-label={quantidade ? `Notificações: ${quantidade} não lidas` : "Notificações"}>
    <Bell size={20} aria-hidden="true" />
    {quantidade > 0 && <span aria-hidden="true" className="absolute -right-1 -top-1 rounded-full bg-ouro px-1.5 text-[10px] font-bold text-black">{quantidade > 99 ? "99+" : quantidade}</span>}
  </Link>;
}
