"use client";

import { useState } from "react";
import type { ExecucaoAgente, PainelAgentes } from "@/lib/agentes/tipos";
import { apiAgentes, dataAgente, ESTADOS } from "./cliente";

type Props = {
  execucoes: ExecucaoAgente[]; catalogo: PainelAgentes["catalogo"]; ocupado: boolean;
  executar: (acao: () => Promise<void>, mensagem: string) => Promise<void>;
};
export function Execucoes({ execucoes, catalogo, ocupado, executar }: Props) {
  const [filtro, setFiltro] = useState("");
  const nomes = new Map(catalogo.map(a => [a.id, a.nome]));
  const lista = filtro ? execucoes.filter(e => e.estado === filtro) : execucoes;
  return <section className="space-y-3" aria-labelledby="execucoes-titulo">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="eyebrow">Histórico e revisão</p><h2 id="execucoes-titulo" className="text-xl font-semibold">Trabalhos dos agentes</h2></div>
      <label className="rotulo mb-0">Filtrar estado<select className="campo mt-1" value={filtro} onChange={e => setFiltro(e.target.value)}><option value="">Todos</option>{Object.entries(ESTADOS).map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}</select></label>
    </div>
    <p className="text-xs text-zinc-500">Trabalhos em aberto e histórico recente, até 100 registros. Pendências têm prioridade na lista.</p>
    {!lista.length ? <p className="cartao py-8 text-center text-sm text-zinc-500">Nenhum trabalho neste filtro. As tarefas e seus resultados aparecerão aqui.</p> : lista.map(ex => <Trabalho key={`${ex.id}:${ex.revisao}`} ex={ex} nomes={nomes} ocupado={ocupado} executar={executar} />)}
  </section>;
}

function Trabalho({ ex, nomes, ocupado, executar }: { ex: ExecucaoAgente; nomes: Map<string, string>; ocupado: boolean; executar: Props["executar"] }) {
  const [revisado, setRevisado] = useState(false);
  const [confirmarCancelamento, setConfirmarCancelamento] = useState(false);
  const concluido = ["CONCLUIDO", "CANCELADO"].includes(ex.estado);
  async function acao(tipo: "aprovar" | "cancelar" | "repetir") {
    await executar(async () => {
      await apiAgentes(`/${encodeURIComponent(ex.id)}`, "POST", { acao: tipo, revisao: ex.revisao, ...(tipo === "aprovar" ? { resultadoHash: ex.resultadoHash } : {}) });
      setRevisado(false); setConfirmarCancelamento(false);
    }, tipo === "aprovar" ? "Resultado aprovado. Os encaminhamentos internos foram registrados." : tipo === "cancelar" ? "Trabalho cancelado." : "Trabalho devolvido à fila.");
  }
  return <details className="cartao group" open={ex.estado === "AGUARDA_APROVACAO" ? true : undefined}>
    <summary className="cursor-pointer space-y-2 marker:text-ouro"><div className="inline-flex w-[calc(100%-1.2rem)] flex-wrap items-start justify-between gap-2 align-top"><div><h3 className="font-semibold">{nomes.get(ex.agenteId) ?? ex.agenteId}</h3><span className="text-xs text-zinc-500">{dataAgente(ex.criadoEm)}</span></div><span className={`rounded-full px-3 py-1 text-xs ${ex.estado === "AGUARDA_APROVACAO" ? "bg-amber-100 text-amber-700" : ex.estado === "FALHOU" || ex.estado === "BLOQUEADO" ? "bg-red-50 text-red-700" : "bg-zinc-100 text-zinc-700"}`}>{ESTADOS[ex.estado] ?? ex.estado}</span></div><p className="mt-2 line-clamp-2 text-sm text-zinc-600">{ex.tarefa}</p></summary>
    <div className="mt-4 space-y-4 border-t border-zinc-200 pt-4">
      <div><p className="rotulo">Pedido original</p><p className="whitespace-pre-wrap break-words text-sm">{ex.tarefa}</p></div>
      {ex.origemId ? <p className="text-xs text-zinc-500">Encaminhado por outro trabalho · referência {ex.origemId}</p> : null}
      {ex.erro ? <p role="status" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{ex.erro}</p> : null}
      {ex.resultado ? <>
        <p className="whitespace-pre-wrap break-words text-sm">{ex.resultado.resumo}</p>
        <Lista titulo="Entregáveis" itens={ex.resultado.entregaveis} />
        <Lista titulo="Pontos de atenção" itens={ex.resultado.alertas} alerta />
        {ex.resultado.proximosPassos.length ? <div><h4 className="mb-2 text-sm font-semibold">Encaminhamentos propostos</h4><ol className="space-y-2">{ex.resultado.proximosPassos.map((p, i) => <li key={i} className="rounded-lg bg-zinc-50 p-3 text-sm"><strong>{nomes.get(p.agenteId) ?? p.agenteId}</strong><p className="mt-1 whitespace-pre-wrap break-words text-zinc-600">{p.tarefa}</p></li>)}</ol></div> : null}
      </> : null}
      {ex.fontes.length ? <div><h4 className="text-xs font-semibold text-zinc-500">Fontes consultadas</h4><ul className="mt-1 space-y-1 text-xs text-zinc-500">{ex.fontes.map((f, i) => <li key={i}>{f.nome} · {dataAgente(f.consultadoEm)}</li>)}</ul></div> : null}
      {ex.estado === "AGUARDA_APROVACAO" && ex.resultado ? <div className="space-y-3 rounded-xl border border-ouro/30 bg-ouro/5 p-4">
        <p className="text-sm">A aprovação confirma este resultado e libera os encaminhamentos internos listados. Publicação de anúncio, envio a clientes e gastos não são autorizados aqui.</p>
        <label className="flex items-start gap-2 text-sm"><input className="mt-1" type="checkbox" checked={revisado} disabled={ocupado} onChange={e => setRevisado(e.target.checked)} /> Revisei o conteúdo, os alertas e os próximos passos.</label>
        <button className="btn-primario" disabled={ocupado || !revisado || !ex.resultadoHash} onClick={() => void acao("aprovar")}>Aprovar resultado e encaminhar</button>
      </div> : null}
      <div className="flex flex-wrap gap-2">
        {["FALHOU", "BLOQUEADO"].includes(ex.estado) ? <button className="btn" disabled={ocupado} onClick={() => void acao("repetir")}>Tentar novamente</button> : null}
        {!concluido && !confirmarCancelamento ? <button className="btn" disabled={ocupado} onClick={() => setConfirmarCancelamento(true)}>Cancelar trabalho</button> : null}
        {!concluido && confirmarCancelamento ? <><span className="self-center text-sm">Cancelar este trabalho? Encaminhamentos já criados continuam na central e precisam ser cancelados separadamente.</span><button className="btn-perigo" disabled={ocupado} onClick={() => void acao("cancelar")}>Confirmar cancelamento</button><button className="btn" disabled={ocupado} onClick={() => setConfirmarCancelamento(false)}>Voltar</button></> : null}
      </div>
      <p className="text-xs text-zinc-500">Revisão {ex.revisao}{ex.modelo ? ` · ${ex.modelo}` : ""}{ex.finalizadoEm ? ` · Finalizado em ${dataAgente(ex.finalizadoEm)}` : ""}</p>
    </div>
  </details>;
}

function Lista({ titulo, itens, alerta = false }: { titulo: string; itens: string[]; alerta?: boolean }) {
  if (!itens.length) return null;
  return <div className={alerta ? "rounded-xl bg-amber-50 p-3" : ""}><h4 className="mb-2 text-sm font-semibold">{titulo}</h4><ul className="list-disc space-y-2 pl-5 text-sm">{itens.map((item, i) => <li key={i} className="whitespace-pre-wrap break-words">{item}</li>)}</ul></div>;
}
