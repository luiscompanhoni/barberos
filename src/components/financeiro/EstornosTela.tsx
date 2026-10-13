"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Check, RefreshCw, RotateCcw, X } from "lucide-react";
import { SeloEstorno, type EstornoResumo } from "@/components/estornos/BotaoEstorno";
import { api, reais } from "@/lib/cliente-api";
import { ROTULO_MEIO, ROTULO_TIPO, type MeioEstorno, type TipoEstorno } from "@/lib/estornos/regras";

type Estorno = EstornoResumo & {
  tipo: TipoEstorno; meio: MeioEstorno; parcial: boolean; valorOriginalCentavos: number; comandaId: string | null; clienteNome: string | null;
  pedidoPor: string | null; decididoPor: string | null; decididoEm: string | null; executadoEm: string | null; gatewayEstornoId: string | null;
};
type Lista = { pendentes: Estorno[]; historico: Estorno[]; dono: boolean };
const quando = (d: string | null) => (d ? new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }) : "");

/** Estornos: pendentes no topo (o dono aprova ou recusa) e o historico. */
export function EstornosTela({ onMudou }: { onMudou?: () => void }) {
  const [l, setL] = useState<Lista | null>(null);
  const [msg, setMsg] = useState<{ t: string; erro?: boolean } | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [recusando, setRecusando] = useState<{ id: string; motivo: string } | null>(null);

  const carregar = useCallback(() => api<Lista>("/api/estornos").then(setL).catch((e) => setMsg({ t: e.message, erro: true })), []);
  useEffect(() => { carregar(); }, [carregar]);

  async function decidir(e: Estorno, acao: "aprovar" | "recusar" | "tentar" | "manual", motivo?: string) {
    if (acao === "aprovar" && !window.confirm(`Aprovar e devolver ${reais(e.valorCentavos)} para ${e.clienteNome ?? "o cliente"}?`)) return;
    if (acao === "manual" && !window.confirm("Confirma que o dinheiro foi devolvido por fora (fora do sistema)?")) return;
    setMsg(null);
    setOcupado(e.id);
    try {
      const r = await api<{ estorno: Estorno }>(`/api/estornos/${e.id}`, { method: "PATCH", body: { acao, motivo } });
      const x = r.estorno;
      setMsg(x.status === "FALHOU" ? { t: `O meio de pagamento recusou: ${x.erro}`, erro: true }
        : x.status === "RECUSADO" ? { t: "Pedido recusado." }
          : x.status === "MANUAL" ? { t: `Registrado. ${x.instrucao ?? ""}` } : { t: "Estorno feito. ✅" });
      setRecusando(null);
      await carregar();
      onMudou?.();
    } catch (x) {
      setMsg({ t: (x as Error).message, erro: true });
    } finally {
      setOcupado(null);
    }
  }

  if (!l) return <p className="text-sm text-zinc-500">{msg?.t ?? "Carregando…"}</p>;
  const linha = (e: Estorno, acoes: boolean) => (
    <li key={e.id} className="cartao space-y-2">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{e.descricao}</p>
          <p className="text-xs text-zinc-500">
            {ROTULO_TIPO[e.tipo]} · {e.clienteNome ?? "sem cliente"} · por {ROTULO_MEIO[e.meio]}
            {e.comandaId && <> · <Link className="underline" href={`/comandas/${e.comandaId}`}>abrir comanda</Link></>}
          </p>
        </div>
        <div className="text-right">
          <p className="font-black">{reais(e.valorCentavos)}</p>
          {e.parcial && <p className="text-[10px] text-zinc-500">parcial de {reais(e.valorOriginalCentavos)}</p>}
          <SeloEstorno status={e.status} />
        </div>
      </div>
      <p className="text-sm"><span className="text-zinc-500">Motivo:</span> {e.motivo}</p>
      <p className="text-xs text-zinc-500">
        Pedido por {e.pedidoPor ?? "—"} em {quando(e.criadoEm)}
        {e.decididoPor && ` · ${e.status === "RECUSADO" ? "recusado" : "aprovado"} por ${e.decididoPor} em ${quando(e.decididoEm)}`}
        {e.executadoEm && ` · devolvido em ${quando(e.executadoEm)}`}
      </p>
      {e.motivoDecisao && e.status === "RECUSADO" && <p className="text-xs"><span className="text-zinc-500">Motivo da recusa:</span> {e.motivoDecisao}</p>}
      {e.instrucao && <p className="rounded-lg bg-violet-50 p-2 text-xs text-violet-900">{e.instrucao}</p>}
      {e.erro && <p className="rounded-lg bg-red-50 p-2 text-xs text-red-700">{e.erro}</p>}
      {acoes && l.dono && e.status === "PENDENTE" && (
        recusando?.id === e.id ? (
          <div className="flex flex-wrap gap-2">
            <input className="campo flex-1" placeholder="Motivo da recusa" autoFocus value={recusando.motivo} onChange={(x) => setRecusando({ id: e.id, motivo: x.target.value })} />
            <button className="btn" onClick={() => setRecusando(null)}>Voltar</button>
            <button className="btn-perigo" disabled={ocupado === e.id || recusando.motivo.trim().length < 3} onClick={() => decidir(e, "recusar", recusando.motivo)}>Recusar</button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button className="btn-primario" disabled={ocupado === e.id} onClick={() => decidir(e, "aprovar")}><Check size={15} /> Aprovar e estornar</button>
            <button className="btn" disabled={ocupado === e.id} onClick={() => setRecusando({ id: e.id, motivo: "" })}><X size={15} /> Recusar</button>
          </div>
        )
      )}
      {acoes && l.dono && e.status === "FALHOU" && (
        <div className="flex flex-wrap gap-2">
          <button className="btn" disabled={ocupado === e.id} onClick={() => decidir(e, "tentar")}><RotateCcw size={15} /> Tentar de novo</button>
          <button className="btn" disabled={ocupado === e.id} onClick={() => decidir(e, "manual")}>Já devolvi por fora</button>
        </div>
      )}
    </li>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <p className="text-sm text-zinc-500">
          {l.dono ? "Todo estorno de dinheiro já recebido passa por você. A recepção pede, você aprova ou recusa." : "Os estornos que você pede ficam aqui até o dono decidir."}
        </p>
        <button className="btn ml-auto" onClick={carregar} aria-label="Atualizar"><RefreshCw size={15} /></button>
      </div>
      {msg && <p className={`rounded-xl p-3 text-sm ${msg.erro ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"}`}>{msg.t}</p>}
      <section className="space-y-2">
        <h2 className="font-semibold">Aguardando decisão {l.pendentes.length > 0 && <span className="ml-1 rounded-full bg-amber-500 px-2 text-xs text-black">{l.pendentes.length}</span>}</h2>
        {l.pendentes.length === 0 ? <p className="cartao text-sm text-zinc-500">Nenhum pedido de estorno esperando.</p> : <ul className="space-y-2">{l.pendentes.map((e) => linha(e, true))}</ul>}
      </section>
      <section className="space-y-2">
        <h2 className="font-semibold">Histórico</h2>
        {l.historico.length === 0 ? <p className="text-sm text-zinc-500">Nenhum estorno ainda.</p> : <ul className="space-y-2">{l.historico.map((e) => linha(e, false))}</ul>}
      </section>
    </div>
  );
}
