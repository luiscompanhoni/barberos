"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/cliente-api";
export function RecomprasCliente() {
  const [itens, setItens] = useState<{ servicoId: string; nome: string }[]>([]);
  useEffect(() => {
    let viva = true;
    api<typeof itens>("/api/recompras/cliente").then(r => { if (viva) setItens(r); }).catch(() => { /* Sugestao opcional nao impede a area do cliente. */ });
    return () => { viva = false; };
  }, []);
  if (!itens.length) return null;
  return <section className="cartao space-y-2" aria-label="Hora de renovar o cuidado"><h2 className="font-semibold">Hora de renovar o cuidado</h2><p className="text-sm text-zinc-500">Pelo intervalo indicado pela barbearia, você já pode repetir: {itens.map(i => i.nome).join(", ")}. Confira o serviço e escolha um horário.</p><Link href="/c/agendar" className="btn-primario">Ver horários</Link></section>;
}
