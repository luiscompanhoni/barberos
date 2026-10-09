"use client";

import { useEffect, useState } from "react";
import { Banknote, CreditCard, LoaderCircle, QrCode, X } from "lucide-react";
import { api, centavosParaTexto, paraCentavos, reais } from "@/lib/cliente-api";
import { FORMAS, ROTULO_FORMA, type Comanda, type Forma, type ModoMaquininha, type Pagamento } from "./tipos";

const ICONE: Record<Forma, typeof CreditCard> = { PIX: QrCode, CREDITO: CreditCard, DEBITO: CreditCard, DINHEIRO: Banknote };

/** Pagamentos lancados + formulario para receber (divide em quantas formas precisar). */
export function Recebimento({ comanda, maquininha, gerente, dono, ocupado, onPagar, onAcaoPagamento }: {
  comanda: Comanda;
  maquininha: ModoMaquininha;
  gerente: boolean;
  dono: boolean;
  ocupado: boolean;
  onPagar: (p: { forma: Forma; valorCentavos: number; naMaquininha: boolean; serial?: string }) => Promise<boolean>;
  onAcaoPagamento: (id: string, acao: "cancelar" | "conferir" | "simular") => void;
}) {
  const r = comanda.resumo;
  const [forma, setForma] = useState<Forma>("PIX");
  const [valor, setValor] = useState("");
  const [jaPassei, setJaPassei] = useState(false);
  const [maquinas, setMaquinas] = useState<{ serial: string; nome: string }[]>([]);
  const [serial, setSerial] = useState("");
  useEffect(() => {
    if (maquininha !== "stone") return;
    api<{ maquininhas: { serial: string; nome: string }[] }>("/api/comandas/maquininhas").then((r) => {
      setMaquinas(r.maquininhas);
      let salvo = "";
      try { salvo = localStorage.getItem("barberos:maquininha") ?? ""; } catch {}
      setSerial(r.maquininhas.some((m) => m.serial === salvo) ? salvo : (r.maquininhas[0]?.serial ?? ""));
    }).catch(() => {});
  }, [maquininha]);
  const escolherMaquina = (v: string) => {
    setSerial(v);
    try { localStorage.setItem("barberos:maquininha", v); } catch {}
  };
  const aberta = comanda.status === "ABERTA";
  const integrada = maquininha !== "manual" && forma !== "DINHEIRO";
  const vivos = comanda.pagamentos.filter((p) => p.status !== "CANCELADO");

  async function pagar(e: React.FormEvent) {
    e.preventDefault();
    const v = valor.trim() ? paraCentavos(valor) : r.falta;
    if (Number.isNaN(v) || v <= 0) return;
    if (await onPagar({ forma, valorCentavos: v, naMaquininha: integrada && !jaPassei, ...(integrada && !jaPassei && serial ? { serial } : {}) })) setValor("");
  }

  return (
    <div className="space-y-3">
      {vivos.length > 0 && (
        <ul className="space-y-2">
          {vivos.map((p) => <LinhaPagamento key={p.id} p={p} aberta={aberta} maquininha={maquininha} podeDesfazer={!p.antecipadoId && !p.linkPagamentoId && gerente && (dono || !p.gatewayPedidoId || p.gatewayPedidoId.startsWith("sim_"))} ocupado={ocupado} onAcao={onAcaoPagamento} />)}
        </ul>
      )}

      {aberta && r.falta > 0 && (
        <form onSubmit={pagar} className="space-y-3 rounded-xl border border-zinc-200 p-3">
          <div className="grid grid-cols-4 gap-1.5">
            {FORMAS.map((f) => {
              const Icone = ICONE[f.valor];
              return (
                <button type="button" key={f.valor} onClick={() => setForma(f.valor)}
                  className={`flex flex-col items-center gap-1 rounded-lg border py-2 text-[11px] font-semibold transition ${forma === f.valor ? "border-ouro bg-ouro/10 text-ouro" : "border-zinc-200 text-zinc-600 hover:border-zinc-400"}`}>
                  <Icone size={16} /> {f.rotulo}
                </button>
              );
            })}
          </div>
          <div className="flex gap-2">
            <input className="campo" inputMode="decimal" placeholder={centavosParaTexto(r.falta)} value={valor} onChange={(e) => setValor(e.target.value)} aria-label="Valor" />
            <button className="btn-primario shrink-0 px-4" disabled={ocupado}>
              {integrada && !jaPassei ? "Mandar p/ maquininha" : "Receber"}
            </button>
          </div>
          {integrada && !jaPassei && maquinas.length > 1 && (
            <select className="campo py-1.5 text-sm" value={serial} onChange={(e) => escolherMaquina(e.target.value)} aria-label="Maquininha">
              {maquinas.map((m) => <option key={m.serial} value={m.serial}>{m.nome}</option>)}
            </select>
          )}
          {integrada && (
            <label className="flex items-center gap-2 text-xs text-zinc-500">
              <input type="checkbox" checked={jaPassei} onChange={(e) => setJaPassei(e.target.checked)} className="accent-[#d3ab45]" />
              Já passei na maquininha (só registrar)
            </label>
          )}
          <p className="text-[11px] text-zinc-500">Em branco = o que falta ({reais(r.falta)}). Pode dividir: lance uma forma de cada vez.</p>
        </form>
      )}
    </div>
  );
}

function LinhaPagamento({ p, aberta, maquininha, podeDesfazer, ocupado, onAcao }: {
  p: Pagamento; aberta: boolean; maquininha: ModoMaquininha; podeDesfazer: boolean; ocupado: boolean;
  onAcao: (id: string, acao: "cancelar" | "conferir" | "simular") => void;
}) {
  const Icone = ICONE[p.forma];
  return (
    <li className={`rounded-xl border p-3 text-sm ${p.status === "AGUARDANDO" ? "border-ouro/50 bg-ouro/5" : "border-zinc-200"}`}>
      <div className="flex items-center gap-2">
        <Icone size={16} className="text-ouro" />
        <span className="font-semibold">{ROTULO_FORMA[p.forma]}</span>
        {p.bandeira && <span className="text-xs text-zinc-500">{p.bandeira}</span>}
        {p.antecipadoId && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">pago online antes</span>}
        {p.linkPagamentoId && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">pago pelo link</span>}
        <span className="ml-auto font-bold">{reais(p.valorCentavos)}</span>
        {aberta && (p.status === "AGUARDANDO" || podeDesfazer) && (
          <button disabled={ocupado} onClick={() => onAcao(p.id, "cancelar")} className="rounded p-1 text-zinc-500 hover:bg-zinc-100 hover:text-red-600" aria-label="Cancelar pagamento" title="Cancelar">
            <X size={14} />
          </button>
        )}
      </div>
      {p.status === "AGUARDANDO" && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <span className="flex items-center gap-1.5 text-ouro"><LoaderCircle size={13} className="animate-spin" /> Esperando o cliente passar na maquininha…</span>
          <span className="ml-auto flex gap-1.5">
            {maquininha === "simulada" && <button disabled={ocupado} className="btn py-1 text-xs" onClick={() => onAcao(p.id, "simular")}>Simular aprovação</button>}
            {maquininha === "stone" && <button disabled={ocupado} className="btn py-1 text-xs" onClick={() => onAcao(p.id, "conferir")}>Conferir</button>}
          </span>
        </div>
      )}
      {p.status === "PAGO" && p.nsu && <p className="mt-1 text-[11px] text-zinc-500">NSU {p.nsu}</p>}
    </li>
  );
}
