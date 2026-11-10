"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { BellRing, Check } from "lucide-react";
import { api, ErroApi } from "@/lib/cliente-api";

type Periodo = "QUALQUER" | "MANHA" | "TARDE" | "NOITE";
type Pedido = { id: string; data: string; servicoId: string; servicosAdicionais: string[]; barbeiroId: string | null; periodo: Periodo };
const PERIODOS: [Periodo, string][] = [["QUALQUER", "Qualquer hora"], ["MANHA", "Manhã"], ["TARDE", "Tarde"], ["NOITE", "Noite"]];

/** Dia sem horário livre: salva o conjunto de serviços e o período, sem reservar vaga. */
export function SemVaga({ data, servicoId, barbeiroId, servicosAdicionais = [], aoAtualizar }: {
  data: string; servicoId: string; barbeiroId: string | null; servicosAdicionais?: string[]; aoAtualizar: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [periodo, setPeriodo] = useState<Periodo>("QUALQUER");
  const [pedidoId, setPedidoId] = useState<string | null>(null);
  const [consultando, setConsultando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [avisosDesativados, setAvisosDesativados] = useState(false);
  const [horariosLiberados, setHorariosLiberados] = useState(false);

  const ocupada = useRef(false);
  const conjunto = JSON.stringify([servicoId, ...servicosAdicionais].sort());

  useEffect(() => {
    let vivo = true;
    api<Pedido[]>("/api/cliente/espera").then(pedidos => {
      if (!vivo) return;
      const salvo = pedidos.find(p => p.data === data && p.barbeiroId === barbeiroId && JSON.stringify([p.servicoId, ...p.servicosAdicionais].sort()) === conjunto);
      if (salvo) { setPedidoId(salvo.id); setPeriodo(salvo.periodo); }
    }).catch(e => { if (vivo) setErro((e as Error).message); }).finally(() => { if (vivo) setConsultando(false); });
    return () => { vivo = false; };
  }, [data, barbeiroId, conjunto]);

  async function salvar(cancelar = false) {
    if (ocupada.current) return;
    ocupada.current = true;
    setSalvando(true); setErro(""); setAvisosDesativados(false); setHorariosLiberados(false);
    try {
      if (cancelar && pedidoId) {
        await api(`/api/cliente/espera?id=${encodeURIComponent(pedidoId)}`, { method: "DELETE" });
        setPedidoId(null); setAberto(false);
      } else {
        const pedido = await api<{ id: string }>("/api/cliente/espera", { method: "POST", body: { data, servicoId, servicosAdicionais, barbeiroId, periodo } });
        setPedidoId(pedido.id);
      }
    } catch (e) {
      setErro((e as Error).message);
      setAvisosDesativados(e instanceof ErroApi && e.codigo === "avisos_desativados");
      setHorariosLiberados(e instanceof ErroApi && e.codigo === "tem_vaga");
    }
    finally { ocupada.current = false; setSalvando(false); }
  }
  return (
    <div className="cartao mt-3 space-y-3 text-sm" aria-busy={consultando || salvando}>
      <p className="text-zinc-500">Não há horários para todos os serviços neste dia{barbeiroId ? " com esse profissional" : ""}. Tente outra data ou peça um aviso se surgir vaga.</p>
      {pedidoId ? <>
        <p role="status" className="flex items-start gap-2"><Check className="shrink-0 text-ouro" size={18} aria-hidden="true" />Pedido de aviso salvo · {PERIODOS.find(([v]) => v === periodo)?.[1]}. Este pedido não reserva um horário.</p>
        <button type="button" className="btn min-h-11 w-full" onClick={() => salvar(true)} disabled={salvando}>Cancelar aviso</button>
      </> : <>
        {!aberto ? <button type="button" className="btn-primario min-h-11 w-full" onClick={() => setAberto(true)} disabled={consultando}>
          <BellRing size={16} aria-hidden="true" />{consultando ? "Consultando pedidos…" : "Me avise se abrir horário"}
        </button> : <>
          <fieldset disabled={salvando}>
            <legend className="mb-2 font-semibold">Qual período você prefere?</legend>
            <p className="mb-3 text-xs text-zinc-500">Manhã: até 12h · Tarde: das 12h às 18h · Noite: a partir das 18h.</p>
            <div className="flex flex-wrap gap-2">
              {PERIODOS.map(([v, r]) => <label key={v} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-zinc-300 px-3 py-2">
                <input type="radio" name="periodo-espera" value={v} checked={periodo === v} onChange={() => setPeriodo(v)} className="accent-ouro" />{r}
              </label>)}
            </div>
          </fieldset>
          <button type="button" className="btn-primario min-h-11 w-full" onClick={() => salvar()} disabled={salvando}>{salvando ? "Salvando…" : "Salvar pedido de aviso"}</button>
        </>}
      </>}
      {erro && <div role="alert" className="space-y-2"><p className="text-red-600">{erro}</p>
        {avisosDesativados && <Link href="/c/privacidade" className="inline-flex min-h-11 items-center font-semibold text-ouro underline">Abrir Meus dados</Link>}
        {horariosLiberados && <button type="button" className="btn min-h-11 w-full" onClick={aoAtualizar} disabled={salvando}>Ver horários disponíveis</button>}
      </div>}
    </div>
  );
}
