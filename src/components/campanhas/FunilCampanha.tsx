"use client";

import { useEffect, useState } from "react";
import { api, reais } from "@/lib/cliente-api";
import type { Funil } from "@/lib/campanhas/funil";

const pct = (x: number | null) => (x === null ? "" : `${(x * 100).toLocaleString("pt-BR", { maximumFractionDigits: x < 0.1 ? 1 : 0 })}%`);

/** Funil da campanha: barras do tamanho de cada etapa (em relacao as mensagens enviadas). */
export function FunilCampanha({ id }: { id: string }) {
  const [f, setF] = useState<Funil | null>(null);
  const [erro, setErro] = useState("");
  useEffect(() => {
    api<Funil>(`/api/campanhas/${id}/funil`).then(setF).catch((e) => setErro(e.message));
  }, [id]);

  if (erro) return <p className="text-sm text-red-600">{erro}</p>;
  if (!f) return <p className="text-sm text-zinc-500">Montando o funil…</p>;
  if (!f.etapas[0].qtd) return <p className="text-sm text-zinc-500">Nenhuma mensagem enviada ainda.</p>;
  return (
    <div className="space-y-3">
      <ul className="space-y-1.5">
        {f.etapas.map((e) => (
          <li key={e.chave} className="grid grid-cols-[minmax(0,9.5rem)_1fr_4.75rem] items-center gap-2 text-sm sm:grid-cols-[12rem_1fr_7rem]">
            <span className="truncate" title={e.detalhe}>{e.rotulo}</span>
            <span className="h-5 overflow-hidden rounded bg-zinc-100">
              {e.doTotal !== null && <span className="block h-full rounded bg-ouro/70" style={{ width: `${Math.max(e.doTotal * 100, e.qtd ? 1.5 : 0)}%` }} />}
            </span>
            <span className="text-right tabular-nums">
              <b>{e.qtd === null ? "—" : e.qtd.toLocaleString("pt-BR")}</b>
              {e.qtd !== null && e.chave !== "enviadas" && <span className="ml-1 text-xs text-zinc-500">{pct(e.doTotal)}</span>}
            </span>
          </li>
        ))}
      </ul>
      <div className="grid grid-cols-3 gap-2 text-center text-sm">
        <div className="rounded-lg bg-zinc-100 px-2 py-1.5"><p className="text-[11px] text-zinc-500">Faturado</p><p className="font-bold text-ouro">{reais(f.faturadoCentavos)}</p></div>
        <div className="rounded-lg bg-zinc-100 px-2 py-1.5"><p className="text-[11px] text-zinc-500">Comandas</p><p className="font-bold">{f.comandas}</p></div>
        <div className="rounded-lg bg-zinc-100 px-2 py-1.5"><p className="text-[11px] text-zinc-500">Ticket por cliente</p><p className="font-bold">{f.ticketMedioCentavos === null ? "—" : reais(f.ticketMedioCentavos)}</p></div>
      </div>
      <p className="text-xs text-zinc-500">
        Agendou = marcou até {f.janelaDias} dias depois de receber. Faturado = o que ficou com a barbearia nas comandas desses atendimentos.
        {f.etapas.find((e) => e.chave === "conta")?.detalhe && ` Conta: ${f.etapas.find((e) => e.chave === "conta")!.detalhe}.`}
        {f.etapas.some((e) => e.qtd === null) && " Entregue e lida só aparecem com o WhatsApp oficial ou a Evolution (o simulador não informa)."}
      </p>
    </div>
  );
}
