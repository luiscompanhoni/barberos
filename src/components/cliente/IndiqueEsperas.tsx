"use client";

import { useCallback, useEffect, useState } from "react";
import { BellRing, Check, Copy, Gift, Share2, X } from "lucide-react";
import { api, reais } from "@/lib/cliente-api";

type Espera = { id: string; data: string; periodo: string; servico: string; barbeiro: string | null };
type Indicacao =
  | { ativa: false }
  | {
      ativa: true; codigo: string; link: string; convite: string; premioIndicadorCentavos: number; premioIndicadoCentavos: number;
      indicados: number; convertidos: number; beneficios: { id: string; descricao: string; valorCentavos: number }[];
    };

const PERIODO: Record<string, string> = { QUALQUER: "", MANHA: " · manhã", TARDE: " · tarde", NOITE: " · noite" };
const dia = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", timeZone: "UTC" });

/** Lista de espera do cliente e o "indique e ganhe" (area do cliente). */
export function IndiqueEsperas() {
  const [esperas, setEsperas] = useState<Espera[]>([]);
  const [ind, setInd] = useState<Indicacao | null>(null);
  const [copiado, setCopiado] = useState(false);

  const carregar = useCallback(() => {
    api<Espera[]>("/api/cliente/espera").then(setEsperas).catch(() => {});
    api<Indicacao>("/api/cliente/indicacao").then(setInd).catch(() => {});
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

      {ind?.ativa && (
        <section className="cartao-destaque space-y-4">
          <div className="flex items-start gap-3">
            <Gift className="shrink-0 text-ouro" size={22} />
            <div>
              <p className="eyebrow">Indique e ganhe</p>
              <h2 className="mt-1 text-lg font-bold">
                Ganhe {reais(ind.premioIndicadorCentavos)} por amigo
              </h2>
              <p className="text-sm text-zinc-500">
                Quando seu amigo fizer o primeiro corte, o desconto cai no seu cadastro.
                {ind.premioIndicadoCentavos > 0 && ` Ele também ganha ${reais(ind.premioIndicadoCentavos)} na primeira visita.`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-xl bg-zinc-100 px-3 py-2 text-sm">
            <span className="min-w-0 flex-1 truncate font-mono text-xs">{ind.link}</span>
            <button className="text-ouro" aria-label="Copiar link" onClick={async () => { await navigator.clipboard?.writeText(ind.link); setCopiado(true); setTimeout(() => setCopiado(false), 2000); }}>
              {copiado ? <Check size={16} /> : <Copy size={16} />}
            </button>
          </div>
          <a className="btn-primario w-full py-3" href={`https://wa.me/?text=${encodeURIComponent(ind.convite)}`} target="_blank" rel="noreferrer">
            <Share2 size={15} /> Mandar para um amigo no WhatsApp
          </a>
          <p className="text-center text-xs text-zinc-500">
            Seu código: <b className="text-zinc-900">{ind.codigo}</b> · {ind.indicados} indicado(s), {ind.convertidos} já vieram
          </p>
          {ind.beneficios.length > 0 && (
            <div className="border-t border-zinc-200 pt-3">
              <p className="rotulo">Seus descontos (saem na próxima visita)</p>
              <ul className="mt-1 space-y-1 text-sm">
                {ind.beneficios.map((b) => <li key={b.id} className="flex justify-between"><span>{b.descricao}</span><b className="text-ouro">{reais(b.valorCentavos)}</b></li>)}
              </ul>
            </div>
          )}
        </section>
      )}
    </>
  );
}
