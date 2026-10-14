"use client";

import { useEffect, useState } from "react";
import { Undo2 } from "lucide-react";
import { useAcesso } from "@/components/AcessoContexto";
import { Modal } from "@/components/Modal";
import { api, centavosParaTexto, paraCentavos, reais } from "@/lib/cliente-api";
import { ROTULO_MEIO, ROTULO_STATUS, type MeioEstorno, type StatusEstorno, type TipoEstorno } from "@/lib/estornos/regras";

export type EstornoResumo = {
  id: string; status: StatusEstorno; valorCentavos: number; motivo: string; descricao: string; instrucao: string | null; erro: string | null;
  motivoDecisao: string | null; criadoEm: string;
};
type Info = {
  descricao: string; clienteNome: string | null; valorOriginal: number; meio: MeioEstorno; parcial: boolean; limite: number; bloqueio: string | null;
  exigeCaixa: boolean; caixaAberto: boolean | null; pedidos: EstornoResumo[];
};

export const COR_STATUS: Record<StatusEstorno, string> = {
  PENDENTE: "bg-amber-50 text-amber-800", APROVADO: "bg-sky-50 text-sky-800", RECUSADO: "bg-zinc-100 text-zinc-600",
  EXECUTADO: "bg-emerald-50 text-emerald-700", FALHOU: "bg-red-50 text-red-700", MANUAL: "bg-violet-50 text-violet-800",
};

export function SeloEstorno({ status }: { status: StatusEstorno }) {
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${COR_STATUS[status]}`}>{ROTULO_STATUS[status]}</span>;
}

/**
 * "Pedir estorno" (recepcao) ou "Estornar" (dono ou quem tem a permissao de estorno) de um pagamento recebido.
 * `oculto` esconde so o botao (o modal aberto continua ate fechar); `onFeito` roda ao fechar o resultado.
 */
export function BotaoEstorno({ tipo, id, className = "btn py-1 text-xs", oculto = false, onFeito }: {
  tipo: TipoEstorno; id: string; className?: string; oculto?: boolean; onFeito?: () => void;
}) {
  const dono = useAcesso().permissoes.estorno;
  const [aberto, setAberto] = useState(false);
  return (
    <>
      {!oculto && (
        <button type="button" className={className} onClick={() => setAberto(true)}>
          <Undo2 size={13} /> {dono ? "Estornar" : "Pedir estorno"}
        </button>
      )}
      {aberto && <ModalEstorno tipo={tipo} id={id} dono={dono} onFechar={(feito) => { setAberto(false); if (feito) onFeito?.(); }} />}
    </>
  );
}

function ModalEstorno({ tipo, id, dono, onFechar }: { tipo: TipoEstorno; id: string; dono: boolean; onFechar: (feito: boolean) => void }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [valor, setValor] = useState("");
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [feito, setFeito] = useState<EstornoResumo | null>(null);

  useEffect(() => {
    api<Info>(`/api/estornos/alvo?tipo=${tipo}&id=${encodeURIComponent(id)}`)
      .then((r) => { setInfo(r); setValor(centavosParaTexto(r.limite)); })
      .catch((e) => setErro(e.message));
  }, [tipo, id]);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!info) return;
    const v = info.parcial ? paraCentavos(valor) : info.limite;
    if (Number.isNaN(v) || v <= 0) return setErro("Valor inválido.");
    if (motivo.trim().length < 3) return setErro("Escreva o motivo do estorno.");
    setErro("");
    setOcupado(true);
    try {
      const r = await api<{ estorno: EstornoResumo }>("/api/estornos", { method: "POST", body: { tipo, referenciaId: id, valorCentavos: v, motivo: motivo.trim() } });
      setFeito(r.estorno);
    } catch (x) {
      setErro((x as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Modal titulo={dono ? "Estornar pagamento" : "Pedir estorno"} onFechar={() => onFechar(!!feito)}>
      {!info ? <p className="text-sm text-zinc-500">{erro || "Carregando…"}</p> : feito ? (
        <div className="space-y-3 text-sm">
          <div className="flex items-center gap-2"><SeloEstorno status={feito.status} /><b>{reais(feito.valorCentavos)}</b></div>
          <p>
            {feito.status === "PENDENTE" ? "Pedido enviado. O dono foi avisado no WhatsApp e decide pelo painel."
              : feito.status === "EXECUTADO" ? "Estorno feito. O dinheiro está sendo devolvido ao cliente."
                : feito.status === "MANUAL" ? "Estorno registrado. Falta devolver por fora:"
                  : feito.status === "FALHOU" ? "O meio de pagamento não aceitou o estorno:" : "Estorno registrado."}
          </p>
          {feito.instrucao && <p className="rounded-lg bg-violet-50 p-2 text-violet-900">{feito.instrucao}</p>}
          {feito.erro && <p className="rounded-lg bg-red-50 p-2 text-red-700">{feito.erro}</p>}
          <button className="btn-primario w-full" onClick={() => onFechar(true)}>Ok</button>
        </div>
      ) : (
        <form onSubmit={enviar} className="space-y-3 text-sm">
          <div className="rounded-lg bg-zinc-50 p-3">
            <p className="font-semibold">{info.descricao}</p>
            <p className="text-xs text-zinc-500">
              {info.clienteNome ? `${info.clienteNome} · ` : ""}pago {reais(info.valorOriginal)} · devolve por {ROTULO_MEIO[info.meio]}
            </p>
          </div>
          {info.pedidos.length > 0 && (
            <ul className="space-y-1 text-xs">
              {info.pedidos.map((p) => (
                <li key={p.id} className="flex items-center gap-2"><SeloEstorno status={p.status} /> {reais(p.valorCentavos)} · {p.motivo}</li>
              ))}
            </ul>
          )}
          {info.bloqueio || info.limite <= 0 ? (
            <p className="rounded-lg bg-amber-50 p-3 text-amber-900">{info.bloqueio ?? "Esse pagamento já foi estornado (ou já tem pedido em aberto)."}</p>
          ) : (
            <>
              {info.exigeCaixa && !info.caixaAberto && (
                <p className="rounded-lg bg-amber-50 p-3 text-amber-900">Estorno em dinheiro sai do caixa como sangria: abra o caixa antes.</p>
              )}
              <label className="block">
                <span className="rotulo">Valor a devolver</span>
                {info.parcial ? (
                  <input className="campo" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} aria-label="Valor do estorno" />
                ) : <p className="font-bold">{reais(info.limite)} <span className="text-xs font-normal text-zinc-500">(esse meio só estorna o total)</span></p>}
                {info.parcial && <span className="text-[11px] text-zinc-500">Máximo {reais(info.limite)}. Pode ser parcial.</span>}
              </label>
              <label className="block">
                <span className="rotulo">Motivo (obrigatório)</span>
                <textarea className="campo" rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: cobrado duas vezes, cliente desistiu do produto" />
              </label>
              {!dono && <p className="text-xs text-zinc-500">O pedido fica aguardando a aprovação do dono, que é avisado no WhatsApp.</p>}
              <button className={dono ? "btn-perigo w-full" : "btn-primario w-full"} disabled={ocupado || (info.exigeCaixa && !info.caixaAberto)}>
                {ocupado ? "Enviando…" : dono ? "Estornar agora" : "Enviar pedido ao dono"}
              </button>
            </>
          )}
          {erro && <p className="text-red-600">{erro}</p>}
        </form>
      )}
    </Modal>
  );
}
