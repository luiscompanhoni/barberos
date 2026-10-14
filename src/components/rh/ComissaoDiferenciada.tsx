"use client";

import { useState } from "react";
import { CalendarX, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/cliente-api";

export type AdicionalLinha = {
  id: string; barbeiroId: string; barbeiro: string; modalidade: "ASSINATURA" | "AVULSO"; pontosBps: number; motivo: string;
  inicio: string; fim: string | null; autorizadoPor: string; situacao: "VIGENTE" | "FUTURO" | "ENCERRADO";
};
type Lista = { hoje: string; fechadas: string[]; adicionais: AdicionalLinha[] };

const MODALIDADE = { ASSINATURA: "Assinaturas", AVULSO: "Avulsos" } as const;
const SITUACAO = { VIGENTE: "Valendo", FUTURO: "Começa depois", ENCERRADO: "Encerrado" } as const;
const dataBr = (d: string) => d.split("-").reverse().join("/");
const pontos = (bps: number) => `${bps > 0 ? "+" : "−"}${(Math.abs(bps) / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} pts`;
const pct = (bps: number) => `${(bps / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;

/**
 * Comissao diferenciada: pontos a mais por barbeiro (assinaturas ou avulsos), com motivo, vigencia e quem autorizou.
 * O que ja valeu nao se apaga (encerra com data de fim); mes com folha fechada nao muda sem reabrir a folha.
 */
export function ComissaoDiferenciada({ barbeiros, inicial, percentualBase }: { barbeiros: { id: string; nome: string }[]; inicial: Lista; percentualBase: number }) {
  const [l, setL] = useState<Lista>(inicial);
  const [msg, setMsg] = useState<{ t: string; erro?: boolean } | null>(null);
  const [novo, setNovo] = useState({ barbeiroId: barbeiros[0]?.id ?? "", modalidade: "ASSINATURA" as keyof typeof MODALIDADE, pontos: "", motivo: "", inicio: inicial.hoje, fim: "" });
  const [enviando, setEnviando] = useState(false);

  async function chamar(fn: () => Promise<Lista>, ok: string) {
    setEnviando(true);
    setMsg(null);
    try {
      setL(await fn());
      setMsg({ t: ok });
      return true;
    } catch (e) {
      setMsg({ t: (e as Error).message, erro: true });
      return false;
    } finally {
      setEnviando(false);
    }
  }

  async function adicionar() {
    const p = Math.round(Number(novo.pontos.replace(",", ".")) * 100);
    if (!Number.isFinite(p) || !p) return setMsg({ t: "Informe os pontos (ex.: 5 para 35% → 40%).", erro: true });
    if (novo.motivo.trim().length < 3) return setMsg({ t: "Escreva o motivo.", erro: true });
    const feito = await chamar(() => api<Lista>("/api/rh/comissoes/adicionais", {
      method: "POST",
      body: { barbeiroId: novo.barbeiroId, modalidade: novo.modalidade, pontosBps: p, motivo: novo.motivo, inicio: novo.inicio, fim: novo.fim || null },
    }), "Comissão diferenciada registrada.");
    if (feito) setNovo({ ...novo, pontos: "", motivo: "", fim: "" });
  }

  function encerrar(a: AdicionalLinha) {
    const fim = prompt(`Último dia em que vale o adicional de ${a.barbeiro} (AAAA-MM-DD):`, l.hoje);
    if (!fim) return;
    chamar(() => api<Lista>(`/api/rh/comissoes/adicionais/${a.id}`, { method: "PATCH", body: { fim } }), "Adicional encerrado.");
  }

  function excluir(a: AdicionalLinha) {
    if (!confirm(`Apagar o adicional de ${a.barbeiro} que ainda não começou?`)) return;
    chamar(() => api<Lista>(`/api/rh/comissoes/adicionais/${a.id}`, { method: "DELETE" }), "Adicional apagado.");
  }

  const exemplo = Number(novo.pontos.replace(",", ".")) || 5;
  return (
    <section className="cartao space-y-3">
      <h2 className="font-semibold">Comissão diferenciada</h2>
      <p className="text-xs text-zinc-500">
        Pontos a mais negociados com um barbeiro (ex.: {pct(percentualBase)} base + {exemplo.toLocaleString("pt-BR")} pts = {pct(percentualBase + exemplo * 100)} nas assinaturas).
        O adicional é pago pela barbearia: não sai da comissão dos outros. Pode ser diferente para assinaturas e avulsos (no avulso, soma ao % da regra do serviço).
        O que já valeu não se apaga: encerre com uma data de fim. Mês com a folha fechada só muda depois de reabrir a folha.
      </p>
      {msg && <p className={`rounded-xl p-3 text-sm ${msg.erro ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"}`}>{msg.t}</p>}

      <div className="grid gap-2 sm:grid-cols-3">
        <div><label className="rotulo">Barbeiro</label>
          <select className="campo" value={novo.barbeiroId} onChange={(e) => setNovo({ ...novo, barbeiroId: e.target.value })}>
            {barbeiros.map((b) => <option key={b.id} value={b.id}>{b.nome}</option>)}
          </select>
        </div>
        <div><label className="rotulo">Vale para</label>
          <select className="campo" value={novo.modalidade} onChange={(e) => setNovo({ ...novo, modalidade: e.target.value as keyof typeof MODALIDADE })}>
            <option value="ASSINATURA">Assinaturas</option>
            <option value="AVULSO">Avulsos</option>
          </select>
        </div>
        <div><label className="rotulo">Pontos a mais</label><input className="campo" inputMode="decimal" placeholder="5" value={novo.pontos} onChange={(e) => setNovo({ ...novo, pontos: e.target.value })} /></div>
        <div><label className="rotulo">Começa em</label><input type="date" className="campo" value={novo.inicio} onChange={(e) => setNovo({ ...novo, inicio: e.target.value })} /></div>
        <div><label className="rotulo">Termina em (opcional)</label><input type="date" className="campo" value={novo.fim} onChange={(e) => setNovo({ ...novo, fim: e.target.value })} /></div>
        <div><label className="rotulo">Motivo</label><input className="campo" placeholder="Ex.: meta de assinaturas batida" value={novo.motivo} onChange={(e) => setNovo({ ...novo, motivo: e.target.value })} /></div>
      </div>
      <button className="btn" disabled={enviando || !barbeiros.length} onClick={adicionar}><Plus size={15} /> Registrar comissão diferenciada</button>

      {l.adicionais.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead><tr className="text-left text-xs text-zinc-500"><th className="py-1">Barbeiro</th><th>Vale para</th><th>Pontos</th><th>Vigência</th><th>Motivo</th><th>Autorizado por</th><th>Situação</th><th /></tr></thead>
            <tbody>
              {l.adicionais.map((a) => (
                <tr key={a.id} className="border-t border-zinc-200">
                  <td className="py-1.5 font-medium">{a.barbeiro}</td>
                  <td>{MODALIDADE[a.modalidade]}</td>
                  <td className="font-semibold">{pontos(a.pontosBps)}</td>
                  <td className="whitespace-nowrap">{a.inicio === "2000-01-01" ? "desde antes" : dataBr(a.inicio)} → {a.fim ? dataBr(a.fim) : "sem fim"}</td>
                  <td className="text-zinc-500">{a.motivo}</td>
                  <td className="text-zinc-500">{a.autorizadoPor}</td>
                  <td><span className={a.situacao === "VIGENTE" ? "selo-ouro" : "text-xs text-zinc-500"}>{SITUACAO[a.situacao]}</span></td>
                  <td className="whitespace-nowrap text-right">
                    {a.situacao !== "ENCERRADO" && <button className="rounded p-1 text-zinc-500 hover:bg-zinc-100" title="Encerrar (data de fim)" disabled={enviando} onClick={() => encerrar(a)}><CalendarX size={15} /></button>}
                    {a.situacao === "FUTURO" && <button className="rounded p-1 text-zinc-500 hover:bg-red-50 hover:text-red-600" title="Apagar (ainda não começou)" disabled={enviando} onClick={() => excluir(a)}><Trash2 size={15} /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
