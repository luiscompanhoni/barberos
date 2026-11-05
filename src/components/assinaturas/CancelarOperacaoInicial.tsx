"use client";

import { useRef, useState } from "react";
import { api } from "@/lib/cliente-api";

export function CancelarOperacaoInicial(p: { endpoint: string; equipe?: boolean; onAlterado: () => Promise<unknown> | void }) {
  const [confirmando, setConfirmando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [mensagem, setMensagem] = useState("");
  const [erro, setErro] = useState(false);
  const trava = useRef(false);
  async function cancelar() {
    if (trava.current) return;
    trava.current = true; setOcupado(true); setMensagem(""); setErro(false);
    try {
      const r = await api<{ cancelada: boolean }>(p.endpoint, { method: p.equipe ? "POST" : "PATCH", body: { acao: "cancelar_operacao" } });
      setMensagem(r.cancelada ? "Operação cancelada. Agora é possível escolher o plano e outra forma de pagamento." : "Pedido em conferência. O pagamento anterior precisa ser encerrado no provedor antes de escolher outra forma; nenhum estorno foi executado.");
      await p.onAlterado();
    } catch (e) { setErro(true); setMensagem((e as Error).message); }
    finally { trava.current = false; setOcupado(false); }
  }
  return <div className="space-y-2">
    {!confirmando ? <button type="button" className="btn" onClick={() => setConfirmando(true)}>Cancelar operação ou trocar forma de pagamento</button> : <div className="rounded-xl bg-amber-50 p-3 text-sm space-y-2">
      <p>Desistir deste primeiro pagamento? Outra forma será liberada quando o cancelamento for confirmado. Esta ação não devolve pagamentos já recebidos.</p>
      <div className="flex flex-wrap gap-2"><button type="button" className="btn" disabled={ocupado} onClick={() => setConfirmando(false)}>Manter pagamento</button>
        <button type="button" className="btn-perigo" disabled={ocupado} onClick={cancelar}>{ocupado ? "Conferindo…" : "Confirmar cancelamento da operação"}</button></div>
    </div>}
    {mensagem && <p role={erro ? "alert" : "status"} className={`text-sm ${erro ? "text-red-700" : "text-zinc-600"}`}>{mensagem}</p>}
  </div>;
}
