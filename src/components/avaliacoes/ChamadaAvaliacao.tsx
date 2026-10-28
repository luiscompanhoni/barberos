"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Star } from "lucide-react";
import { api } from "@/lib/cliente-api";

export function ChamadaAvaliacao() {
  const [pendente, setPendente] = useState(false);
  useEffect(() => {
    let ativa = true;
    api<{ convite: { respondida: boolean; expirada: boolean } | null }>("/api/cliente/avaliacoes")
      .then(r => { if (ativa) setPendente(!!r.convite && !r.convite.respondida && !r.convite.expirada); }).catch(() => {});
    return () => { ativa = false; };
  }, []);
  if (!pendente) return null;
  return <Link href="/c/avaliacoes" className="cartao-destaque flex items-center gap-3 p-4"><Star className="shrink-0 text-ouro" size={24} /><span><strong className="block">Como foi sua primeira visita?</strong><span className="text-sm text-zinc-600">Sua avaliação é interna. Seu nome fica oculto para o barbeiro.</span></span></Link>;
}
