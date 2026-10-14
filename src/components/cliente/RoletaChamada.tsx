"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CalendarPlus, Dices, Gift } from "lucide-react";
import { api } from "@/lib/cliente-api";

type Estado = { ativa: boolean; giros: number; aRetirar: { id: string; rotulo: string; expiraEm: string | null }[] };
const ate = (d: string) => new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });

/**
 * Chamada da roleta na tela inicial: giro esperando ("Girar agora") e brinde a retirar ("Agendar para resgatar").
 * Sem giro nem premio, nao aparece (a tela inicial nao fica cheia).
 */
export function RoletaChamada() {
  const [e, setE] = useState<Estado | null>(null);
  useEffect(() => { api<Estado>("/api/cliente/roleta").then(setE).catch(() => setE(null)); }, []);
  if (!e?.ativa || (e.giros <= 0 && !e.aRetirar.length)) return null;

  return (
    <section className="roleta-moldura space-y-3 rounded-2xl p-5 text-[#ffffff]">
      {e.giros > 0 && (
        <>
          <div className="flex items-center gap-3">
            <Dices className="shrink-0 text-[#ffd21f]" size={30} />
            <div>
              <p className="roleta-titulo text-2xl leading-none">+{e.giros} {e.giros === 1 ? "giro" : "giros"}</p>
              <p className="mt-1 text-sm text-[#cbd5e1]">Seu prêmio está esperando na roleta.</p>
            </div>
          </div>
          <Link href="/c/roleta" className="roleta-coletar block w-full rounded-xl py-3.5 text-center text-base">Girar agora</Link>
        </>
      )}
      {e.aRetirar.map((p) => (
        <div key={p.id} className="flex items-center gap-3 rounded-xl bg-[#ffffff1a] p-3 text-sm">
          <Gift className="shrink-0 text-[#ffd21f]" size={20} />
          <span className="min-w-0 flex-1"><b>{p.rotulo}</b> para retirar{p.expiraEm && <span className="text-[#cbd5e1]"> · até {ate(p.expiraEm)}</span>}</span>
        </div>
      ))}
      {e.aRetirar.length > 0 && (
        <Link href="/c/agendar" className={`${e.giros > 0 ? "border border-[#ffd21f] text-[#ffd21f]" : "roleta-coletar"} flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold`}>
          <CalendarPlus size={16} /> Agendar para resgatar
        </Link>
      )}
    </section>
  );
}
