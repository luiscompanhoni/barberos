"use client";

import { useCallback, useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
import { api, reais } from "@/lib/cliente-api";
import { formatarTelefone } from "@/lib/telefone";
import { FORMA, ROTULO } from "./AssinaturasTela";

type Detalhe = {
  id: string;
  status: keyof typeof ROTULO;
  formaPagamento: string;
  precoCentavos: number;
  criadaEm: string;
  ativadaEm: string | null;
  canceladaEm: string | null;
  motivoCancelamento: string | null;
  proximoVencimento: string | null;
  cliente: { nome: string; telefone: string; cpf: string | null };
  plano: { nome: string };
  cobrancas: { id: string; valorCentavos: number; vencimento: string; status: string; pagaEm: string | null; link: string | null }[];
  agendamentos: { id: string; inicio: string; status: string; servico: { nome: string } }[];
  simulado: boolean;
};

const STATUS_COB: Record<string, string> = { PENDENTE: "Em aberto", PAGA: "Paga", ATRASADA: "Vencida", CANCELADA: "Cancelada", ESTORNADA: "Estornada" };
const dataBr = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");

export function DetalheAssinatura(p: { id: string; dono: boolean; onFechar: () => void; onAlterado: () => void }) {
  const [d, setD] = useState<Detalhe | null>(null);
  const [msg, setMsg] = useState<{ texto: string; erro?: boolean } | null>(null);
  const [motivo, setMotivo] = useState("");
  const [cancelando, setCancelando] = useState(false);

  const carregar = useCallback(() => api<Detalhe>(`/api/assinaturas/${p.id}`).then(setD).catch((e) => setMsg({ texto: e.message, erro: true })), [p.id]);
  useEffect(() => {
    carregar();
  }, [carregar]);

  async function acao(acao: string, texto: string, extra: object = {}) {
    setMsg(null);
    try {
      await api(`/api/assinaturas/${p.id}`, { method: "POST", body: { acao, ...extra } });
      setMsg({ texto });
      await carregar();
      p.onAlterado();
    } catch (e) {
      setMsg({ texto: (e as Error).message, erro: true });
    }
  }

  if (!d) return <Modal titulo="Assinatura" onFechar={p.onFechar}><p className="text-sm text-zinc-500">{msg?.texto ?? "Carregando..."}</p></Modal>;
  const temAberta = d.cobrancas.some((c) => c.status === "PENDENTE" || c.status === "ATRASADA");

  return (
    <Modal titulo={d.cliente.nome} onFechar={p.onFechar}>
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded px-2 py-0.5 text-xs ${ROTULO[d.status].cor}`}>{ROTULO[d.status].texto}</span>
          <span>{d.plano.nome} · {reais(d.precoCentavos)}/mês · {FORMA[d.formaPagamento]}</span>
        </div>
        <dl className="grid grid-cols-[130px_1fr] gap-y-1">
          <dt className="text-zinc-500">Celular</dt><dd>{formatarTelefone(d.cliente.telefone)}</dd>
          <dt className="text-zinc-500">CPF</dt><dd>{d.cliente.cpf ?? "—"}</dd>
          <dt className="text-zinc-500">Assinante desde</dt><dd>{dataBr(d.ativadaEm)}</dd>
          {d.status !== "CANCELADA" && (<><dt className="text-zinc-500">Próx. vencimento</dt><dd>{dataBr(d.proximoVencimento)}</dd></>)}
          {d.canceladaEm && (<><dt className="text-zinc-500">Cancelada em</dt><dd>{dataBr(d.canceladaEm)} · {d.motivoCancelamento}</dd></>)}
        </dl>

        <div>
          <p className="mb-1 font-medium">Cobranças</p>
          <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200">
            {d.cobrancas.map((c) => (
              <li key={c.id} className="flex items-center gap-2 px-3 py-1.5">
                <span>{dataBr(c.vencimento)}</span>
                <span>{reais(c.valorCentavos)}</span>
                <span className={c.status === "PAGA" ? "text-emerald-700" : c.status === "ATRASADA" ? "text-red-700" : "text-zinc-500"}>
                  {STATUS_COB[c.status] ?? c.status}{c.pagaEm ? ` em ${dataBr(c.pagaEm)}` : ""}
                </span>
                {c.link && (c.status === "PENDENTE" || c.status === "ATRASADA") && (
                  <button className="ml-auto text-xs underline" onClick={() => { navigator.clipboard?.writeText(c.link!); setMsg({ texto: "Link copiado." }); }}>copiar link</button>
                )}
              </li>
            ))}
          </ul>
        </div>

        {d.agendamentos.length > 0 && (
          <p className="text-xs text-zinc-500">
            Últimos usos: {d.agendamentos.slice(0, 5).map((a) => `${dataBr(a.inicio)} ${a.servico.nome}${a.status === "FALTOU" ? " (faltou)" : ""}`).join(" · ")}
          </p>
        )}

        {d.status !== "CANCELADA" && (
          <div className="flex flex-wrap gap-2">
            {temAberta && <button className="btn-primario" onClick={() => acao("cobrar", "Cobrança enviada no WhatsApp.")}>Cobrar no WhatsApp</button>}
            <button className="btn" onClick={() => acao("sincronizar", "Status atualizado com o meio de pagamento.")}>Atualizar status</button>
            {p.dono && !cancelando && <button className="btn-perigo" onClick={() => setCancelando(true)}>Cancelar assinatura</button>}
          </div>
        )}
        {cancelando && (
          <div className="space-y-2 rounded-lg bg-red-50 p-3">
            <input className="campo" placeholder="Motivo do cancelamento" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
            <div className="flex gap-2">
              <button className="btn" onClick={() => setCancelando(false)}>Voltar</button>
              <button className="btn-perigo" onClick={() => motivo.trim() ? acao("cancelar", "Assinatura cancelada.", { motivo }) : setMsg({ texto: "Informe o motivo.", erro: true })}>
                Confirmar cancelamento
              </button>
            </div>
          </div>
        )}

        {d.simulado && d.status !== "CANCELADA" && (
          <div className="rounded-lg border border-dashed border-amber-400 p-3">
            <p className="mb-2 text-xs text-amber-900">Modo simulado (sem Asaas): faça o papel do meio de pagamento.</p>
            <div className="flex flex-wrap gap-2">
              {temAberta && <button className="btn text-xs" onClick={() => acao("simular_pagamento", "Pagamento simulado.")}>Cliente pagou</button>}
              {temAberta && <button className="btn text-xs" onClick={() => acao("simular_atraso", "Cobrança marcada como vencida.")}>Venceu sem pagar</button>}
              <button className="btn text-xs" onClick={() => acao("simular_proximo_mes", "Cobrança do próximo mês gerada.")}>Gerar próximo mês</button>
            </div>
          </div>
        )}
        {msg && <p className={msg.erro ? "text-red-600" : "text-emerald-700"}>{msg.texto}</p>}
      </div>
    </Modal>
  );
}
