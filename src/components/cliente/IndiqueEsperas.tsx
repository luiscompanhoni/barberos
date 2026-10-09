"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, BellRing, Wallet, X } from "lucide-react";
import { api, reais } from "@/lib/cliente-api";

type Espera = { id: string; data: string; periodo: string; servico: string; barbeiro: string | null };
type Resumo = {
  saldoCentavos: number;
  cashback: { ativo: boolean; pct: number };
  indicacao: { ativa: false } | { ativa: true; premioIndicadorCentavos: number };
};

const PERIODO: Record<string, string> = { QUALQUER: "", MANHA: " · manhã", TARDE: " · tarde", NOITE: " · noite" };
const dia = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", timeZone: "UTC" });

/** Lista de espera do cliente e o resumo do saldo (cashback + indicacao), na area do cliente. */
export function IndiqueEsperas() {
  const [esperas, setEsperas] = useState<Espera[]>([]);
  const [saldo, setSaldo] = useState<Resumo | null>(null);

  const carregar = useCallback(() => {
    api<Espera[]>("/api/cliente/espera").then(setEsperas).catch(() => {});
    api<Resumo>("/api/cliente/saldo").then(setSaldo).catch(() => {});
  }, []);
  useEffect(carregar, [carregar]);

  async function sair(id: string) {
    await api(`/api/cliente/espera?id=${id}`, { method: "DELETE" }).catch(() => {});
    carregar();
  }

  return (
    <>
      {esperas.length > 0 && (
        <section>
          <h2 className="flex items-center gap-2 text-lg font-bold"><BellRing className="text-ouro" size={18} /> Esperando vaga</h2>
          <ul className="mt-2 space-y-2">
            {esperas.map((e) => (
              <li key={e.id} className="cartao flex items-center gap-3 p-4 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold first-letter:uppercase">{dia(e.data)}{PERIODO[e.periodo]}</p>
                  <p className="text-xs text-zinc-500">{e.servico}{e.barbeiro ? ` com ${e.barbeiro}` : ""} · avisamos no WhatsApp se abrir</p>
                </div>
                <button onClick={() => sair(e.id)} className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-red-600" aria-label="Sair da lista" title="Sair da lista"><X size={15} /></button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {saldo && (saldo.saldoCentavos > 0 || saldo.cashback.ativo || saldo.indicacao.ativa) && (
        <Link href="/c/saldo" className="cartao-clicavel flex items-center gap-4">
          <Wallet className="shrink-0 text-ouro" size={24} />
          <div className="min-w-0 flex-1 text-sm">
            <p className="text-xs text-zinc-500">Seu saldo</p>
            <p className="text-xl font-black text-ouro">{reais(saldo.saldoCentavos)}</p>
            <p className="text-xs text-zinc-500">
              {[saldo.cashback.ativo && `${saldo.cashback.pct}% de cashback`, saldo.indicacao.ativa && `${reais(saldo.indicacao.premioIndicadorCentavos)} por amigo indicado`].filter(Boolean).join(" · ")}
            </p>
          </div>
          <span className="flex items-center gap-1 text-xs font-semibold text-ouro">Ver <ArrowRight size={13} /></span>
        </Link>
      )}
    </>
  );
}
