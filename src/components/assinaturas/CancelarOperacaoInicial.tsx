"use client";

import { useRef, useState } from "react";
import { api } from "@/lib/cliente-api";

export function CancelarOperacaoInicial(p: { endpoint: string; assinaturaId: string; equipe?: boolean; emConferencia?: boolean; continuar?: React.ReactNode; onAlterado: () => Promise<unknown> | void }) {
  const [confirmando, setConfirmando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [mensagem, setMensagem] = useState("");
  const [erro, setErro] = useState(false);
  const [manter, setManter] = useState(false);
  const [encerrada, setEncerrada] = useState(false);
  const trava = useRef(false);
  async function manterPagamento() {
    if (!p.emConferencia) return setManter(true);
    if (trava.current) return;
    trava.current = true; setOcupado(true); setMensagem(""); setErro(false);
    try {
      await api<{ mantida: boolean }>(p.endpoint, { method: p.equipe ? "POST" : "PATCH", body: { acao: "manter_operacao", ...(p.equipe ? {} : { assinaturaId: p.assinaturaId }) } });
      setConfirmando(false); setManter(true); setMensagem("Pagamento mantido. Continue pela opção existente abaixo.");
      await p.onAlterado();
    } catch (e) { setErro(true); setMensagem((e as Error).message); }
    finally { trava.current = false; setOcupado(false); }
  }
  async function cancelar() {
    if (trava.current) return;
    trava.current = true; setOcupado(true); setMensagem(""); setErro(false);
    try {
      const r = await api<{ cancelada: boolean }>(p.endpoint, { method: p.equipe ? "POST" : "PATCH", body: { acao: "cancelar_operacao", ...(p.equipe ? {} : { assinaturaId: p.assinaturaId }) } });
      setConfirmando(false); setEncerrada(r.cancelada); setManter(!r.cancelada);
      setMensagem(r.cancelada ? "Operação cancelada. Agora é possível escolher o plano e outra forma de pagamento." : p.equipe
        ? "Confira a cobrança no provedor. Após confirmar o encerramento sem recebimento, use o botão de confirmação novamente."
        : "A equipe precisa conferir a cobrança no provedor. Se quiser continuar com o Pix original, use Manter pagamento.");
      await p.onAlterado();
    } catch (e) { setErro(true); setMensagem((e as Error).message); }
    finally { trava.current = false; setOcupado(false); }
  }
  return <div className="space-y-2">
    {!encerrada && (!confirmando ? <div className="flex flex-wrap gap-2"><button type="button" className="btn" disabled={ocupado} onClick={manterPagamento}>{ocupado ? "Conferindo…" : "Manter pagamento"}</button><button type="button" className="btn max-w-full" style={{ whiteSpace: "normal" }} disabled={ocupado} onClick={() => { setConfirmando(true); setManter(false); }}>Cancelar operação ou trocar forma de pagamento</button></div> : <div className="rounded-xl bg-amber-50 p-3 text-sm space-y-2">
      <p>Desistir deste primeiro pagamento? Outra forma será liberada quando o cancelamento for confirmado. Esta ação não devolve pagamentos já recebidos.</p>
      <div className="flex flex-wrap gap-2"><button type="button" className="btn" disabled={ocupado} onClick={manterPagamento}>Manter pagamento</button>
        <button type="button" className="btn-perigo max-w-full" style={{ whiteSpace: "normal" }} disabled={ocupado} onClick={cancelar}>{ocupado ? "Conferindo…" : "Confirmar cancelamento da operação"}</button></div>
    </div>)}
    {manter && !encerrada && p.continuar}
    {mensagem && <p role={erro ? "alert" : "status"} className={`text-sm ${erro ? "text-red-700" : "text-zinc-600"}`}>{mensagem}</p>}
  </div>;
}
