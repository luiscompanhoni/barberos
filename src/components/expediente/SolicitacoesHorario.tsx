"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/cliente-api";
import { minParaHhmm } from "@/lib/agenda/tempo";

type Pedido = {
  id: string; tipo: "SEMANA" | "FOLGA" | "BLOQUEIO"; status: string; criadoEm: string; motivoDecisao: string | null;
  proposto: { diaSemana: number; inicioMin: number; fimMin: number }[] | { data: string; inicioMin: number; fimMin: number; motivo: string };
  conflitos: { id: string; inicio: string; cliente: { nome: string }; servico: { nome: string } }[];
};
const dias = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export function SolicitacoesHorario(p: { barbeiroId: string; gestao: boolean; revisao: number; onDecisao: () => void }) {
  const [pedidos, setPedidos] = useState<Pedido[]>([]), [erro, setErro] = useState(""), [ocupado, setOcupado] = useState(false), [motivo, setMotivo] = useState("");
  const carregar = useCallback(() => api<Pedido[]>(`/api/barbeiros/${p.barbeiroId}/solicitacoes-horario`).then(setPedidos).catch(e => setErro(e.message)), [p.barbeiroId]);
  useEffect(() => { void carregar(); }, [carregar, p.revisao]);
  async function decidir(pedidoId: string, decisao: "aprovar" | "recusar") {
    setErro(""); setOcupado(true);
    try {
      await api(`/api/barbeiros/${p.barbeiroId}/solicitacoes-horario`, { method: "POST", body: { acao: "decidir", pedidoId, decisao, motivo } });
      setMotivo(""); await carregar(); p.onDecisao();
    } catch (e) { setErro((e as Error).message); } finally { setOcupado(false); }
  }
  return <section className="cartao space-y-3"><h2 className="font-semibold">Solicitações de horário</h2>
    <p className="text-sm text-zinc-500">Conflitos são verificados nos atendimentos futuros. Nenhum atendimento é cancelado automaticamente.</p>
    {erro && <p role="alert" className="text-sm text-red-700">{erro}</p>}
    {pedidos.length === 0 && <p className="text-sm text-zinc-500">Nenhuma solicitação.</p>}
    {pedidos.map(s => <article key={s.id} className="space-y-2 border-t border-zinc-200 pt-3 text-sm">
      <p><b>{s.status === "PENDENTE" ? "Aguardando aprovação" : s.status === "APROVADA" ? "Aprovada" : "Recusada"}</b> · {new Date(s.criadoEm).toLocaleString("pt-BR")}</p>
      {s.tipo === "SEMANA" && Array.isArray(s.proposto) ? <p>Semana proposta: {s.proposto.length ? s.proposto.map((l, i) => <span key={i}>{i > 0 && "; "}{dias[l.diaSemana]} {minParaHhmm(l.inicioMin)}–{minParaHhmm(l.fimMin)}</span>) : "todos os dias sem expediente"}.</p> : !Array.isArray(s.proposto) && <p>{s.tipo === "FOLGA" ? "Folga" : "Bloqueio"}: {s.proposto.data.split("-").reverse().join("/")} · {minParaHhmm(s.proposto.inicioMin)}–{minParaHhmm(s.proposto.fimMin)}{s.proposto.motivo && ` · ${s.proposto.motivo}`}</p>}
      {s.motivoDecisao && <p>Observação: {s.motivoDecisao}</p>}
      {s.status === "PENDENTE" && <><p>{s.conflitos.length ? `${s.conflitos.length} atendimento(s) fora do horário proposto:` : "Nenhum atendimento futuro afetado."}</p>
        {s.conflitos.length > 0 && <ul className="list-inside list-disc">{s.conflitos.map(c => <li key={c.id}>{new Date(c.inicio).toLocaleString("pt-BR")} · {c.cliente.nome} · {c.servico.nome}</li>)}</ul>}
        {p.gestao && <><label className="rotulo">Observação para a equipe (opcional)<input className="campo" maxLength={500} value={motivo} onChange={e => setMotivo(e.target.value)} /></label><div className="flex flex-wrap gap-2"><button className="btn-primario" disabled={ocupado || s.conflitos.length > 0} onClick={() => decidir(s.id, "aprovar")}>Aprovar horário</button><button className="btn" disabled={ocupado} onClick={() => decidir(s.id, "recusar")}>Recusar</button></div>{s.conflitos.length > 0 && <p className="text-zinc-600">Resolva os atendimentos afetados antes de aprovar.</p>}</>}
      </>}
    </article>)}
  </section>;
}
