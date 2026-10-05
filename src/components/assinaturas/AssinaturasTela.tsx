"use client";

import { useCallback, useEffect, useState } from "react";
import { api, reais } from "@/lib/cliente-api";
import { formatarTelefone } from "@/lib/telefone";
import { DetalheAssinatura } from "./DetalheAssinatura";
import { NovaAssinatura } from "./NovaAssinatura";

type Status = "PENDENTE" | "ATIVA" | "ATRASADA" | "CANCELADA";
export type ItemAssinatura = {
  id: string;
  status: Status;
  formaPagamento: string;
  precoCentavos: number;
  proximoVencimento: string | null;
  criadaEm: string;
  cliente: { id: string; nome: string; telefone: string; cpf: string | null };
  plano: { nome: string };
  cobrancas: { status: string; vencimento: string }[];
};
type Dados = {
  resumo: {
    ativas: number; atrasadas: number; pendentes: number; receitaMensalCentavos: number;
    vendidasNoMes: number; canceladasNoMes: number; motivos: { motivo: string; total: number; detalhes: string[] }[];
  };
  assinaturas: ItemAssinatura[];
};

export const ROTULO: Record<Status, { texto: string; cor: string }> = {
  ATIVA: { texto: "Ativa", cor: "bg-emerald-100 text-emerald-800" },
  ATRASADA: { texto: "Atrasada", cor: "bg-red-100 text-red-800" },
  PENDENTE: { texto: "Aguardando pagamento", cor: "bg-amber-100 text-amber-900" },
  CANCELADA: { texto: "Cancelada", cor: "bg-zinc-100 text-zinc-600" },
};
export const FORMA: Record<string, string> = { CARTAO: "Cartão", PIX: "Pix", BOLETO: "Boleto" };
const dataBr = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");

export function AssinaturasTela({ dono }: { dono: boolean }) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [status, setStatus] = useState<Status | "TODAS">("TODAS");
  const [busca, setBusca] = useState("");
  const [aberta, setAberta] = useState<string | null>(null);
  const [nova, setNova] = useState(false);
  const [erro, setErro] = useState("");

  const carregar = useCallback(() => {
    const q = new URLSearchParams({ status, ...(busca.trim().length >= 2 ? { busca: busca.trim() } : {}) });
    api<Dados>(`/api/assinaturas?${q}`).then(setDados).catch((e) => setErro(e.message));
  }, [status, busca]);
  useEffect(() => {
    const t = setTimeout(carregar, 200);
    return () => clearTimeout(t);
  }, [carregar]);

  const r = dados?.resumo;
  const saldo = r ? r.vendidasNoMes - r.canceladasNoMes : 0;

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold">Assinaturas</h1>
        <button className="btn-primario ml-auto" onClick={() => setNova(true)}>+ Vender plano</button>
      </div>
      {erro && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</p>}

      {r && (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card rotulo="Assinantes ativos" valor={String(r.ativas + r.atrasadas)} detalhe={`${r.atrasadas} com pagamento atrasado`} ruim={r.atrasadas > 0} />
          <Card rotulo="Receita recorrente (mês)" valor={reais(r.receitaMensalCentavos)} detalhe="soma das mensalidades ativas" />
          <Card rotulo="Vendas × cancelamentos no mês" valor={`${r.vendidasNoMes} × ${r.canceladasNoMes}`}
            detalhe={saldo >= 0 ? `saldo +${saldo}` : `saldo ${saldo}: mais saídas que entradas`} ruim={saldo < 0} />
          <Card rotulo="Aguardando 1º pagamento" valor={String(r.pendentes)} detalhe="link enviado, ainda não pago" />
        </section>
      )}

      {r && r.motivos.length > 0 && (
        <section className="cartao text-sm">
          <h2 className="mb-1 font-semibold">Por que cancelaram (90 dias)</h2>
          <div className="flex flex-wrap gap-2">
            {r.motivos.map((m) => (
              <span key={m.motivo} className="rounded-full bg-zinc-100 px-3 py-1" title={m.detalhes.join(" · ")}>
                {m.motivo}: <b>{m.total}</b>{m.detalhes.length > 0 && <span className="text-zinc-500"> · &quot;{m.detalhes[0]}&quot;</span>}
              </span>
            ))}
          </div>
        </section>
      )}

      <section className="cartao space-y-3 p-0">
        <div className="flex flex-wrap gap-2 p-3">
          {(["TODAS", "ATIVA", "ATRASADA", "PENDENTE", "CANCELADA"] as const).map((s) => (
            <button key={s} onClick={() => setStatus(s)}
              className={`rounded-full px-3 py-1 text-sm ${status === s ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-700"}`}>
              {s === "TODAS" ? "Todas" : ROTULO[s].texto}
            </button>
          ))}
          <input className="campo ml-auto max-w-60" placeholder="Buscar cliente" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-y border-zinc-200 bg-zinc-50 text-left text-xs text-zinc-500">
              <tr>
                <th className="px-3 py-2 font-medium">Cliente</th>
                <th className="px-3 py-2 font-medium">Plano</th>
                <th className="px-3 py-2 font-medium">Situação</th>
                <th className="px-3 py-2 font-medium">Mensalidade</th>
                <th className="px-3 py-2 font-medium">Próx. vencimento</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {dados?.assinaturas.map((a) => (
                <tr key={a.id} className="cursor-pointer hover:bg-zinc-50" onClick={() => setAberta(a.id)}>
                  <td className="px-3 py-2">
                    <p className="font-medium">{a.cliente.nome}</p>
                    <p className="text-xs text-zinc-500">{formatarTelefone(a.cliente.telefone)}</p>
                  </td>
                  <td className="px-3 py-2">{a.plano.nome}</td>
                  <td className="px-3 py-2"><span className={`rounded px-2 py-0.5 text-xs ${ROTULO[a.status].cor}`}>{ROTULO[a.status].texto}</span></td>
                  <td className="px-3 py-2">{reais(a.precoCentavos)} · {FORMA[a.formaPagamento]}</td>
                  <td className="px-3 py-2">{a.status === "CANCELADA" ? "—" : dataBr(a.proximoVencimento)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {dados && dados.assinaturas.length === 0 && <p className="p-4 text-sm text-zinc-500">Nenhuma assinatura aqui.</p>}
        </div>
      </section>

      {aberta && <DetalheAssinatura id={aberta} dono={dono} onFechar={() => setAberta(null)} onAlterado={carregar} />}
      {nova && <NovaAssinatura onFechar={() => setNova(false)} onCriada={carregar} />}
    </div>
  );
}

function Card(p: { rotulo: string; valor: string; detalhe: string; ruim?: boolean }) {
  return (
    <div className="cartao space-y-1">
      <p className="text-xs font-medium text-zinc-500">{p.rotulo}</p>
      <p className="text-2xl font-semibold">{p.valor}</p>
      <p className={`text-xs ${p.ruim ? "text-red-700" : "text-zinc-500"}`}>{p.detalhe}</p>
    </div>
  );
}
