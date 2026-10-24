"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowDownCircle, ArrowUpCircle, Lock, LockOpen, Printer, Receipt, X } from "lucide-react";
import { api, reais } from "@/lib/cliente-api";

type Linha = {
  tipo: "ABERTURA" | "PAGAMENTO" | "TROCO" | "SANGRIA" | "SUPRIMENTO" | "DESPESA" | "ESTORNO" | "FECHAMENTO"; em: string; descricao: string; valorCentavos: number;
  dinheiro: boolean; forma?: string | null; comanda?: number | null; cliente?: string | null; online?: boolean; contado?: number | null; esperado?: number | null;
  diferenca?: number | null; entrada: boolean; efeitoCentavos: number; saldoCentavos: number;
};
type Extrato = {
  caixa: {
    id: string; status: "ABERTO" | "FECHADO"; abertoEm: string; fechadoEm: string | null; fundoCentavos: number; abertoPor: string | null; fechadoPor: string | null;
    contadoCentavos: number | null; esperadoCentavos: number | null; diferencaCentavos: number | null; observacao: string | null;
  };
  linhas: Linha[]; saldoDinheiro: number;
};
type Filtro = "todos" | "entradas" | "saidas" | "DINHEIRO" | "PIX" | "DEBITO" | "CREDITO" | "ONLINE";

const FILTROS: { k: Filtro; r: string }[] = [
  { k: "todos", r: "Tudo" }, { k: "entradas", r: "Entradas" }, { k: "saidas", r: "Saídas" }, { k: "DINHEIRO", r: "Dinheiro" },
  { k: "PIX", r: "Pix" }, { k: "DEBITO", r: "Débito" }, { k: "CREDITO", r: "Crédito" }, { k: "ONLINE", r: "Pago antes" },
];
const ROTULO_FORMA: Record<string, string> = { DINHEIRO: "Dinheiro", PIX: "Pix", DEBITO: "Débito", CREDITO: "Crédito" };
const hora = (d: string) => new Date(d).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
const dataHora = (d: string) => new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

function passa(l: Linha, f: Filtro) {
  if (f === "todos") return true;
  if (l.tipo === "ABERTURA" || l.tipo === "FECHAMENTO") return false;
  if (f === "entradas") return l.entrada;
  if (f === "saidas") return !l.entrada;
  if (f === "ONLINE") return !!l.online;
  return l.forma === f && !l.online;
}

/** Movimentacao do caixa linha a linha, com o saldo de dinheiro da gaveta. `versao` muda para recarregar. */
export function ExtratoCaixa({ caixaId, versao = 0, compacto = false, onFechar }: { caixaId: string; versao?: number; compacto?: boolean; onFechar?: () => void }) {
  const [e, setE] = useState<Extrato | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>("todos");

  useEffect(() => {
    let vivo = true;
    api<Extrato>(`/api/financeiro/caixa/${caixaId}/extrato`).then((x) => vivo && (setE(x), setErro(null))).catch((x) => vivo && setErro(x.message));
    return () => { vivo = false; };
  }, [caixaId, versao]);

  if (erro) return <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{erro}</p>;
  if (!e) return <p className="text-sm text-zinc-500">Carregando movimentação…</p>;
  const visiveis = e.linhas.filter((l) => passa(l, filtro));
  const linhas = compacto ? e.linhas.slice(-10).reverse() : visiveis;
  const soma = (f: (l: Linha) => boolean) => visiveis.filter(f).reduce((t, l) => t + l.valorCentavos, 0);
  const c = e.caixa;

  return (
    <div className="extrato-impressao space-y-3">
      <style>{`@media print {
        body * { visibility: hidden !important; }
        .extrato-impressao, .extrato-impressao * { visibility: visible !important; color: #000 !important; background: #fff !important; border-color: #ccc !important; }
        .extrato-impressao { position: absolute; left: 0; top: 0; width: 100%; padding: 12px; }
        .sem-impressao { display: none !important; }
      }`}</style>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 font-semibold"><Receipt size={16} className="text-ouro" /> Movimentação do caixa</h3>
          <p className="text-xs text-zinc-500">
            {dataHora(c.abertoEm)}{c.abertoPor ? ` (${c.abertoPor})` : ""} → {c.fechadoEm ? `${dataHora(c.fechadoEm)}${c.fechadoPor ? ` (${c.fechadoPor})` : ""}` : "aberto"}
          </p>
        </div>
        <div className="sem-impressao flex gap-2">
          {!compacto && <button className="btn" onClick={() => window.print()}><Printer size={15} /> Imprimir/Salvar PDF</button>}
          {onFechar && <button className="btn" onClick={onFechar} aria-label="Fechar"><X size={15} /></button>}
        </div>
      </div>

      {!compacto && (
        <div className="sem-impressao flex flex-wrap gap-1.5">
          {FILTROS.map((f) => (
            <button key={f.k} className={`rounded-full border px-3 py-1 text-xs ${filtro === f.k ? "border-ouro bg-ouro/15 font-semibold text-ouro" : "border-zinc-200 text-zinc-600"}`} onClick={() => setFiltro(f.k)}>{f.r}</button>
          ))}
        </div>
      )}

      {linhas.length === 0 ? <p className="text-sm text-zinc-500">Nada para mostrar.</p> : (
        <div className="overflow-x-auto">
          <table className={`w-full text-sm [&_td]:px-2 [&_th]:px-2 ${compacto ? "" : "min-w-[640px]"}`}>
            <thead className="text-left text-[11px] uppercase tracking-wider text-zinc-500">
              <tr><th className="py-1.5">Hora</th><th>Descrição</th>{!compacto && <th>Forma</th>}<th className="text-right">Valor</th><th className="text-right">Gaveta</th></tr>
            </thead>
            <tbody className="divide-y divide-zinc-200">
              {linhas.map((l, i) => (
                <tr key={`${l.tipo}-${l.em}-${i}`} className={l.tipo === "ABERTURA" || l.tipo === "FECHAMENTO" ? "bg-zinc-50" : ""}>
                  <td className="py-1.5 text-xs text-zinc-500">{hora(l.em)}</td>
                  <td>
                    <span className="flex items-center gap-1.5">
                      {l.tipo === "ABERTURA" ? <LockOpen size={13} className="text-ouro" /> : l.tipo === "FECHAMENTO" ? <Lock size={13} className="text-ouro" />
                        : l.entrada ? <ArrowDownCircle size={13} className="text-emerald-600" /> : <ArrowUpCircle size={13} className="text-red-600" />}
                      <span>{l.tipo === "SANGRIA" ? l.descricao.replace(/^Sangria/i, "Retirada do caixa") : l.tipo === "SUPRIMENTO" ? l.descricao.replace(/^Suprimento/i, "Entrada no caixa") : l.descricao}{l.cliente ? ` · ${l.cliente}` : ""}</span>
                      {l.online && <span className="selo-ouro text-[10px]">{l.tipo === "ESTORNO" ? "online" : "pago antes"}</span>}
                      {l.tipo === "ESTORNO" && !l.dinheiro && <span className="text-[10px] text-zinc-500">(não sai da gaveta)</span>}
                    </span>
                    {l.tipo === "FECHAMENTO" && (
                      <span className="block text-[11px] text-zinc-500">
                        esperado {reais(l.esperado ?? 0)} · contado {reais(l.contado ?? 0)} ·{" "}
                        <b className={l.diferenca ? "text-red-600" : "text-emerald-600"}>{l.diferenca ? `diferença ${l.diferenca > 0 ? "+" : ""}${reais(l.diferenca)}` : "bateu"}</b>
                      </span>
                    )}
                  </td>
                  {!compacto && <td className="text-xs text-zinc-500">{l.online ? "Online" : l.forma ? ROTULO_FORMA[l.forma] ?? l.forma : "—"}</td>}
                  <td className={`whitespace-nowrap text-right font-semibold ${l.tipo === "FECHAMENTO" ? "" : l.entrada ? "text-emerald-600" : "text-red-600"}`}>
                    {l.tipo === "FECHAMENTO" ? reais(l.valorCentavos) : `${l.entrada ? "+" : "−"}${reais(l.valorCentavos)}`}
                  </td>
                  <td className={`whitespace-nowrap text-right ${l.efeitoCentavos ? "font-semibold" : "text-zinc-400"}`}>{reais(l.saldoCentavos)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {compacto ? (
        <p className="flex items-center justify-between text-xs text-zinc-500">
          <span>Últimas {linhas.length} de {e.linhas.length} linha(s)</span>
          <Link href="/caixa" className="font-semibold text-ouro underline">ver tudo</Link>
        </p>
      ) : (
        <p className="text-xs text-zinc-500">
          Entradas {reais(soma((l) => l.entrada && l.tipo !== "ABERTURA" && l.tipo !== "FECHAMENTO"))} · saídas {reais(soma((l) => !l.entrada))} ·
          dinheiro na gaveta {reais(e.saldoDinheiro)}{c.observacao ? ` · obs.: ${c.observacao}` : ""}
        </p>
      )}
    </div>
  );
}
