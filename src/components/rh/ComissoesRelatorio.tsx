"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { api, reais } from "@/lib/cliente-api";

type Soma = { qtd: number; base: number; comissao: number };
type Atend = { id: string; inicio: string; cliente: string; servico: string; modalidade: "AVULSO" | "PLANO"; base: number; regra: string; comissao: number };
type Linha = { barbeiroId: string; nome: string; avulso: Soma; plano: Soma; total: number; semRegra: number; atendimentos: Atend[] };
type Dados = { inicio: string; fim: string; total: number; barbeiros: Linha[] };

const dataHora = (d: string) => new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

/** Relatorio de comissoes do periodo por barbeiro (avulso x plano) com o detalhe dos atendimentos. */
export function ComissoesRelatorio() {
  const [d, setD] = useState<Dados | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  const [erro, setErro] = useState("");

  const carregar = useCallback((inicio?: string, fim?: string) => {
    api<Dados>(`/api/rh/comissoes/relatorio${inicio && fim ? `?inicio=${inicio}&fim=${fim}` : ""}`).then((r) => { setErro(""); setD(r); }).catch((e) => setErro(e.message));
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div><label className="rotulo">De</label><input type="date" className="campo" value={d?.inicio ?? ""} onChange={(e) => d && carregar(e.target.value, d.fim)} /></div>
        <div><label className="rotulo">Até</label><input type="date" className="campo" value={d?.fim ?? ""} onChange={(e) => d && carregar(d.inicio, e.target.value)} /></div>
        {d && <p className="ml-auto text-sm">Total do período: <b className="text-lg text-ouro">{reais(d.total)}</b></p>}
      </div>
      {erro && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{erro}</p>}
      {d && d.barbeiros.length === 0 && <div className="cartao text-sm text-zinc-500">Nenhum atendimento concluído no período.</div>}
      {d?.barbeiros.map((b) => (
        <section key={b.barbeiroId} className="cartao space-y-2">
          <button className="flex w-full flex-wrap items-center gap-3 text-left" onClick={() => setAberto(aberto === b.barbeiroId ? null : b.barbeiroId)}>
            {aberto === b.barbeiroId ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            <span className="flex-1 font-semibold">{b.nome}</span>
            <span className="text-xs text-zinc-500">Avulso: {b.avulso.qtd} · base {reais(b.avulso.base)} · <b>{reais(b.avulso.comissao)}</b></span>
            <span className="text-xs text-zinc-500">Plano: {b.plano.qtd} · base {reais(b.plano.base)} · <b>{reais(b.plano.comissao)}</b></span>
            <span className="w-28 text-right text-lg font-black text-ouro">{reais(b.total)}</span>
          </button>
          {b.semRegra > 0 && <p className="text-xs text-amber-700">{b.semRegra} atendimento(s) de serviço sem regra salva (não geraram comissão). Configure em “Regras de comissão”.</p>}
          {aberto === b.barbeiroId && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-xs">
                <thead><tr className="text-left text-zinc-500"><th className="py-1">Data</th><th>Cliente</th><th>Serviço</th><th>Tipo</th><th className="text-right">Preço base</th><th>Regra</th><th className="text-right">Comissão</th></tr></thead>
                <tbody>
                  {b.atendimentos.map((a) => (
                    <tr key={a.id} className="border-t border-zinc-200">
                      <td className="py-1">{dataHora(a.inicio)}</td>
                      <td>{a.cliente}</td>
                      <td>{a.servico}</td>
                      <td><span className={a.modalidade === "PLANO" ? "selo-ouro" : "text-zinc-500"}>{a.modalidade === "PLANO" ? "Plano" : "Avulso"}</span></td>
                      <td className="text-right">{reais(a.base)}</td>
                      <td className="text-zinc-500">{a.regra}</td>
                      <td className="text-right font-semibold">{reais(a.comissao)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
