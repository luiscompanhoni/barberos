"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/cliente-api";
import type { ConfigRecompra } from "@/lib/recompras/schemas";

type Servico = ConfigRecompra["servicos"][number] & { nome: string };
type Tela = { config: Omit<ConfigRecompra, "servicos">; servicos: Servico[]; avisos: { id: string; estado: string; erro: string | null; tentativas: number; criadoEm: string; enviadoEm: string | null; cliente: { nome: string } }[]; conversao: { desde: string; ofertas: number; aceitas: number; recusadas: number; percentual: number | null } };
export function RecomprasConfiguracao() {
  const [tela, setTela] = useState<Tela | null>(null);
  const [erro, setErro] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [salvando, setSalvando] = useState(false);
  const carregar = useCallback(async () => { try { setTela(await api<Tela>("/api/recompras/configuracao")); } catch (e) { setErro((e as Error).message); } }, []);
  useEffect(() => { let viva = true; api<Tela>("/api/recompras/configuracao").then(t => { if (viva) setTela(t); }).catch(e => { if (viva) setErro(e.message); }); return () => { viva = false; }; }, []);
  const mudar = <K extends keyof Tela["config"]>(k: K, v: Tela["config"][K]) => setTela(t => t && ({ ...t, config: { ...t.config, [k]: v } }));
  const mudarServico = (id: string, k: "intervaloRecompraDias" | "custoCentavos", v: number | null) => setTela(t => t && ({ ...t, servicos: t.servicos.map(s => s.id === id ? { ...s, [k]: v } : s) }));
  async function salvar(e: React.FormEvent) {
    e.preventDefault(); if (!tela) return;
    setSalvando(true); setErro(""); setMensagem("");
    try { setTela(await api<Tela>("/api/recompras/configuracao", { method: "PATCH", body: { ...tela.config, servicos: tela.servicos } })); setMensagem("Configuração salva."); }
    catch (e) { setErro((e as Error).message); }
    finally { setSalvando(false); }
  }
  async function conferir(id: string, estado: "ENVIADO" | "CANCELADO") {
    const motivo = prompt("Confira o histórico da conversa no WhatsApp. Descreva o que verificou (mínimo 5 caracteres):");
    if (!motivo) return;
    try { await api("/api/recompras/avisos", { method: "POST", body: { id, estado, motivo } }); await carregar(); }
    catch (e) { setErro((e as Error).message); }
  }
  if (!tela) return <p role="status">{erro || "Carregando configuração…"}</p>;
  const c = tela.config;
  return <form onSubmit={salvar} className="space-y-5">
    <div><h1 className="titulo-marca">Recompra e custos</h1><p className="mt-2 text-sm text-zinc-500">Defina os intervalos por serviço, custos e condições comerciais. Valores vazios ficam como dados não informados.</p></div>
    <section className="cartao space-y-2"><h2 className="font-semibold">Ofertas registradas nos últimos 30 dias</h2><p className="text-sm">{tela.conversao.ofertas} oportunidades oferecidas · {tela.conversao.aceitas} aceitas · {tela.conversao.recusadas} recusadas · conversão {tela.conversao.percentual === null ? "sem dados" : `${tela.conversao.percentual}%`}</p><p className="text-xs text-zinc-500">Aceite representa serviço agendado; o recebimento só entra no financeiro quando realizado.</p></section>
    <section className="cartao space-y-3">
      <h2 className="font-semibold">Recomendações e lembretes</h2>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={c.ativo} onChange={e => mudar("ativo", e.target.checked)} /> Ativar sugestões de recompra no Meu dia</label>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={c.whatsapp} onChange={e => mudar("whatsapp", e.target.checked)} /> Enviar lembretes pelo WhatsApp configurado</label>
      <label className="rotulo block">Intervalo mínimo entre contatos (dias)<input className="campo mt-1 max-w-36" type="number" min="1" max="90" value={c.intervaloContatoDias} onChange={e => mudar("intervaloContatoDias", Number(e.target.value))} /></label>
      <p className="text-xs text-zinc-500">Os serviços são agrupados numa mensagem, em horário comercial. Respostas PARAR, recusas e agendamentos suspendem os lembretes correspondentes.</p>
    </section>
    <section className="cartao space-y-3"><h2 className="font-semibold">Serviços</h2><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-zinc-500"><th className="p-2">Serviço</th><th className="p-2">Recompra em dias</th><th className="p-2">Custo variável (R$)</th></tr></thead><tbody>{tela.servicos.map(s => <tr key={s.id} className="border-t border-zinc-200"><td className="p-2">{s.nome}</td><td className="p-2"><input aria-label={`Intervalo de ${s.nome}`} type="number" min="1" max="730" className="campo max-w-40" placeholder="Desativado" value={s.intervaloRecompraDias ?? ""} onChange={e => mudarServico(s.id, "intervaloRecompraDias", e.target.value === "" ? null : Number(e.target.value))} /></td><td className="p-2"><input aria-label={`Custo de ${s.nome}`} type="number" min="0" step="0.01" className="campo max-w-40" placeholder="Não informado" value={s.custoCentavos === null ? "" : s.custoCentavos / 100} onChange={e => mudarServico(s.id, "custoCentavos", e.target.value === "" ? null : Math.round(Number(e.target.value) * 100))} /></td></tr>)}</tbody></table></div></section>
    <section className="cartao space-y-3"><h2 className="font-semibold">Oferta de reativação</h2><label className="flex gap-2 text-sm"><input type="checkbox" checked={c.descontoAtivo} onChange={e => mudar("descontoAtivo", e.target.checked)} /> Autorizar desconto nos serviços sugeridos</label>
      <p className="text-sm text-zinc-500">Vale para clientes sem visita pelo período abaixo. Só aparece quando custo e comissão estão definidos e a margem mínima é preservada. A oferta vale uma vez por serviço no ciclo. Quem aplicar também precisa da permissão de desconto.</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="rotulo">Sem visita há (dias)<input className="campo mt-1" type="number" min="1" max="365" value={c.reativacaoDias} onChange={e => mudar("reativacaoDias", Number(e.target.value))} /></label>
        <label className="rotulo">Desconto máximo (%)<input className="campo mt-1" type="number" min="0" max="50" value={c.descontoPct} onChange={e => mudar("descontoPct", Number(e.target.value))} /></label>
        <label className="rotulo">Limite do desconto (R$)<input className="campo mt-1" type="number" min="0" step="0.01" value={c.descontoMaxCentavos / 100} onChange={e => mudar("descontoMaxCentavos", Math.round(Number(e.target.value) * 100))} /></label>
        <label className="rotulo">Validade da oferta (dias)<input className="campo mt-1" type="number" min="1" max="90" value={c.descontoValidadeDias} onChange={e => mudar("descontoValidadeDias", Number(e.target.value))} /></label>
        <label className="rotulo">Margem mínima após comissão (%)<input className="campo mt-1" type="number" min="0" max="100" value={c.margemMinimaPct} onChange={e => mudar("margemMinimaPct", Number(e.target.value))} /></label>
      </div>
    </section>
    {erro && <p role="alert" className="text-sm text-red-600">{erro}</p>}{mensagem && <p role="status" className="text-sm text-emerald-700">{mensagem}</p>}
    <button className="btn-primario" disabled={salvando}>{salvando ? "Salvando…" : "Salvar configuração"}</button>
    <section className="cartao space-y-3"><h2 className="font-semibold">Últimos lembretes</h2><p className="text-xs text-zinc-500">Falha antes de tentar o envio pode ser repetida automaticamente. Resultado incerto exige conferência da conversa para evitar mensagens duplicadas.</p>{!tela.avisos.length ? <p className="text-sm text-zinc-500">Nenhum lembrete processado.</p> : tela.avisos.map(a => <div key={a.id} className="border-t border-zinc-200 pt-2 text-sm"><span className="font-semibold">{a.cliente.nome} · {a.estado}</span> · {new Date(a.criadoEm).toLocaleString("pt-BR")} · {a.tentativas} tentativa(s){a.erro && <p className="text-xs text-zinc-500">{a.erro}</p>}{["INCERTO", "PROCESSANDO"].includes(a.estado) && <div className="mt-2 flex gap-2"><button type="button" className="btn" onClick={() => conferir(a.id, "ENVIADO")}>Conferi: foi enviado</button><button type="button" className="btn" onClick={() => conferir(a.id, "CANCELADO")}>Encerrar sem reenvio</button></div>}</div>)}</section>
  </form>;
}
