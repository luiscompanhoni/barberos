"use client";

import { useState } from "react";
import { reais } from "@/lib/cliente-api";
import { combinarCenarios } from "@/lib/reunioes/cenarios";
import type { ProjecaoServico } from "@/lib/reunioes/tipos";

export function CenarioCombinado({ servicos, baseCentavos, granularidadeMin, intervaloMin, fuso }: { servicos: ProjecaoServico[]; baseCentavos: number; granularidadeMin: number; intervaloMin: number; fuso: string }) {
  const [pedidos, setPedidos] = useState<Record<string, number>>({});
  const r = combinarCenarios(servicos, pedidos, granularidadeMin, intervaloMin);
  if (!servicos.length) return null;
  const hora = (s: string) => new Date(s).toLocaleTimeString("pt-BR", { timeZone: fuso, hour: "2-digit", minute: "2-digit" });
  return <section className="cartao space-y-3"><h3 className="font-semibold">Combinar serviços na projeção</h3><p className="text-sm text-zinc-500">Escolha quantidades de serviços diferentes. A combinação respeita os espaços livres e os intervalos entre clientes, sem criar reservas. A distribuição é uma sugestão viável; a demanda ainda precisa ser confirmada.</p>
    <div className="grid gap-3 sm:grid-cols-3">{servicos.map((s) => <label className="rotulo" key={s.servicoId}>{s.nome}<input className="campo mt-1" type="number" min={0} max={s.quantidadeMaxima} value={pedidos[s.servicoId] ?? 0} onChange={(e) => setPedidos((p) => ({ ...p, [s.servicoId]: Math.min(s.quantidadeMaxima, Math.max(0, Number(e.target.value))) }))} /></label>)}</div>
    <div className="rounded-xl border border-ouro/30 p-3 text-sm"><p>{r.total.quantidade} serviço(s) adicionais cabem · {r.total.minutos} minutos de atendimento</p><p className="mt-1">Receita prevista com a combinação: <b className="text-ouro">{reais(baseCentavos + r.total.receitaCentavos)}</b></p><p>Comissão adicional: {r.total.comissaoCentavos === null ? "pendente/restrita" : reais(r.total.comissaoCentavos)} · Margem adicional antes de taxas: {r.total.margemCentavos === null ? "pendente/restrita" : reais(r.total.margemCentavos)}</p>
      {r.naoAlocados > 0 && <p className="mt-2 text-amber-600" role="status">{r.naoAlocados} serviço(s) solicitado(s) não couberam nesta distribuição. Ajuste as quantidades ou revise a agenda.</p>}</div>
    {r.horarios.length > 0 && <details><summary className="cursor-pointer text-sm">Ver distribuição sugerida</summary><ul className="mt-2 space-y-1 text-sm">{r.horarios.map((h) => <li key={`${h.servicoId}:${h.inicio}`}>{hora(h.inicio)}–{hora(h.fim)} · {servicos.find((s) => s.servicoId === h.servicoId)?.nome}</li>)}</ul></details>}
  </section>;
}
