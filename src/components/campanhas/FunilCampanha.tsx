"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { api, reais } from "@/lib/cliente-api";
import type { Funil } from "@/lib/campanhas/funil";
import estilos from "./funil-crm.module.css";

const pct = (x: number | null) => (x === null ? "" : `${(x * 100).toLocaleString("pt-BR", { maximumFractionDigits: x < 0.1 ? 1 : 0 })}%`);

/** Etapas reais da campanha, mantendo as barras relativas às mensagens enviadas. */
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
    <div className={`space-y-4 ${estilos.funil}`}>
      <ul className={estilos.etapas} aria-label="Etapas do funil da campanha">
        {f.etapas.map((e, indice) => (
          <li key={e.chave} className={estilos.etapa} style={{ "--atraso": `${indice * 45}ms` } as CSSProperties}>
            <div className={estilos.cabecalho}>
              <span className={estilos.bolinha} aria-hidden="true" />
              <span className={estilos.rotulo} title={e.detalhe}>{e.rotulo}</span>
              <span className={estilos.ordem} aria-hidden="true">{String(indice + 1).padStart(2, "0")}</span>
            </div>
            <span className={estilos.valor}>
              <b>{e.qtd === null ? "—" : e.qtd.toLocaleString("pt-BR")}</b>
              {e.qtd !== null && e.chave !== "enviadas" && <span className={estilos.percentual}>{pct(e.doTotal)}</span>}
            </span>
            <span className={estilos.trilho} aria-hidden="true">
              {e.doTotal !== null && <span className={estilos.barra} style={{ width: `${Math.max(e.doTotal * 100, e.qtd ? 1.5 : 0)}%` }} />}
            </span>
          </li>
        ))}
      </ul>
      <div className={estilos.resumo}>
        <div className={estilos.metrica}><p>Faturado</p><strong className={estilos.faturado}>{reais(f.faturadoCentavos)}</strong></div>
        <div className={estilos.metrica}><p>Comandas</p><strong>{f.comandas}</strong></div>
        <div className={estilos.metrica}><p>Ticket por cliente</p><strong>{f.ticketMedioCentavos === null ? "—" : reais(f.ticketMedioCentavos)}</strong></div>
      </div>
      <p className="text-xs text-zinc-500">
        Agendou = marcou até {f.janelaDias} dias depois de receber. Faturado = o que ficou com a barbearia nas comandas desses atendimentos.
        {f.etapas.find((e) => e.chave === "conta")?.detalhe && ` Conta: ${f.etapas.find((e) => e.chave === "conta")!.detalhe}.`}
        {f.etapas.some((e) => e.qtd === null) && " Entregue e lida só aparecem com o WhatsApp oficial ou a Evolution (o simulador não informa)."}
      </p>
    </div>
  );
}
