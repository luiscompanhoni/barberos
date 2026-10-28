"use client";

import { useState } from "react";
import { PROGRAMA_INICIAL, type Nivel, type Programa } from "@/lib/desempenho/schemas";
import type { Acao, PainelDesempenho } from "./tipos";

const NIVEIS: Nivel[] = ["ELITE", "PLATINA", "LEGEND"];

export function ProgramaForm(p: { regras: PainelDesempenho["regras"]; hoje: string; acao: Acao; salvando: boolean }) {
  const [ano, mes] = p.hoje.split("-").map(Number);
  const proximo = `${mes === 12 ? ano + 1 : ano}-${String(mes === 12 ? 1 : mes + 1).padStart(2, "0")}`;
  const [competencia, setCompetencia] = useState(proximo);
  const [config, setConfig] = useState<Programa>(p.regras[0]?.config ?? PROGRAMA_INICIAL);
  const atualizarFaixa = (nivel: Nivel, chave: keyof Programa["faixas"][Nivel], valor: number | null) => setConfig({ ...config, faixas: { ...config.faixas, [nivel]: { ...config.faixas[nivel], [chave]: valor } } });
  return <form className="cartao space-y-5" onSubmit={(e) => { e.preventDefault(); void p.acao({ acao: "programa", competenciaInicio: competencia, config }); }}>
    <div><h2 className="font-semibold">Regras do programa de bônus</h2><p className="mt-1 text-sm text-zinc-500">Novas regras passam a valer no próximo mês ou depois. Faixas e pontos já conquistados permanecem no histórico. Nenhum valor é pago automaticamente.</p></div>
    <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Vigência inicial<input required className="campo mt-1" type="month" min={proximo} value={competencia} onChange={(e) => { setCompetencia(e.target.value); const regra = p.regras.find((r) => r.competenciaInicio === e.target.value); if (regra) setConfig(regra.config); }} /></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={config.ativo} onChange={(e) => setConfig({ ...config, ativo: e.target.checked })} />Programa ativo a partir dessa competência</label></div>
    <label className="block max-w-xs text-sm">Tolerância de entrada/saída (minutos)<input required className="campo mt-1" type="number" min={0} max={60} value={config.toleranciaMin} onChange={(e) => setConfig({ ...config, toleranciaMin: Number(e.target.value) })} /></label>
    <label className="block max-w-xs text-sm">Pausas combinadas por dia (máximo em minutos)<input required className="campo mt-1" type="number" min={0} max={600} value={config.pausaMaxMin} onChange={(e) => setConfig({ ...config, pausaMaxMin: Number(e.target.value) })} /></label>
    <div className="grid gap-4 lg:grid-cols-3">{NIVEIS.map((nivel) => {
      const f = config.faixas[nivel];
      return <fieldset className="space-y-3 rounded-xl border border-zinc-200 p-4" key={nivel}><legend className="px-1 text-sm font-semibold">BLACK {nivel}</legend>
        <label className="block text-sm">Bônus mensal (R$)<input required className="campo mt-1" type="number" min={0} max={100000} step="0.01" value={f.bonusCentavos / 100} onChange={(e) => atualizarFaixa(nivel, "bonusCentavos", Math.round(Number(e.target.value) * 100))} /></label>
        <label className="block text-sm">Presença mínima (%)<input required className="campo mt-1" type="number" min={0} max={100} value={f.presencaMinPct} onChange={(e) => atualizarFaixa(nivel, "presencaMinPct", Number(e.target.value))} /></label>
        <label className="block text-sm">Checklist validado mínimo (%)<input required className="campo mt-1" type="number" min={0} max={100} value={f.checklistMinPct} onChange={(e) => atualizarFaixa(nivel, "checklistMinPct", Number(e.target.value))} /></label>
        <label className="block text-sm">Nota mínima da liderança<input className="campo mt-1" type="number" min={1} max={5} step="0.1" placeholder="Não exigir" value={f.liderMin ?? ""} onChange={(e) => atualizarFaixa(nivel, "liderMin", e.target.value === "" ? null : Number(e.target.value))} /></label>
        <label className="block text-sm">Nota mínima dos clientes<input className="campo mt-1" type="number" min={1} max={5} step="0.1" placeholder="Não exigir" value={f.clientesMin ?? ""} onChange={(e) => atualizarFaixa(nivel, "clientesMin", e.target.value === "" ? null : Number(e.target.value))} /></label>
        <p className="text-xs text-zinc-500">Campos de nota vazios não exigem esse critério. Nota de clientes usa apenas lotes de pelo menos 5 pessoas.</p>
      </fieldset>;
    })}</div>
    <fieldset className="space-y-3"><legend className="font-semibold">Pontos adicionais ao cumprir as metas do mês</legend><p className="text-xs text-zinc-500">Pontuação concedida uma vez no fechamento, junto do bônus. O checklist mantém seus próprios pontos. Liderança e clientes só geram os pontos abaixo quando forem critérios exigidos na faixa.</p><div className="grid gap-3 sm:grid-cols-3">{([["pontosPresenca", "Presença"], ["pontosLider", "Liderança"], ["pontosClientes", "Clientes"]] as const).map(([k, nome]) => <label className="text-sm" key={k}>{nome}<input required className="campo mt-1" type="number" min={0} max={1500} value={config[k]} onChange={(e) => setConfig({ ...config, [k]: Number(e.target.value) })} /></label>)}</div></fieldset>
    <button className="btn-primario" disabled={p.salvando}>Salvar regras com vigência</button>
  </form>;
}
