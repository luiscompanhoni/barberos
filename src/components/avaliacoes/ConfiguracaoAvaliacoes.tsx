"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/cliente-api";

type Config = { ativo: boolean; whatsapp: boolean; jogoId: string | null; validadeDias: number; recompensaValidadeDias: number };
type Painel = { configuracao: Config; jogos: { id: string; nome: string }[]; falhasWhatsApp: number };

export function ConfiguracaoAvaliacoes() {
  const [painel, setPainel] = useState<Painel | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [mensagem, setMensagem] = useState("");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  useEffect(() => {
    let ativo = true;
    api<Painel>("/api/avaliacoes/config").then(r => { if (ativo) { setPainel(r); setConfig(r.configuracao); } }).catch(e => { if (ativo) setErro(e.message); });
    return () => { ativo = false; };
  }, []);
  async function salvar(e: React.FormEvent) {
    e.preventDefault(); if (!config) return;
    setSalvando(true); setErro(""); setMensagem("");
    try {
      await api("/api/avaliacoes/config", { method: "PATCH", body: config });
      setMensagem("Configuração salva. Novos convites seguirão estas regras; os já enviados preservam a recompensa prometida.");
    } catch (e) { setErro((e as Error).message); }
    finally { setSalvando(false); }
  }
  async function reenviar() {
    setSalvando(true); setErro(""); setMensagem("");
    try {
      const r = await api<{ mensagem: string }>("/api/avaliacoes/reenviar", { method: "POST" });
      setMensagem(r.mensagem);
    } catch (e) { setErro((e as Error).message); }
    finally { setSalvando(false); }
  }
  return <section className="cartao space-y-3"><h2 className="font-semibold">Configurar avaliações e recompensa</h2>
    <p className="text-sm text-zinc-600">A primeira visita elegível após a ativação recebe um convite. Identidade consultável somente pelo dono, com registro de acesso. Notas baixas concedem a mesma recompensa.</p>
    {erro && <p role="alert" className="text-red-600">{erro}</p>}
    {mensagem && <p role="status" className="text-emerald-700">{mensagem}</p>}
    {config && painel && <form onSubmit={salvar} className="space-y-4">
      <label className="flex items-center gap-2"><input type="checkbox" checked={config.ativo} onChange={e => setConfig({ ...config, ativo: e.target.checked })} />Ativar convites após a primeira visita</label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={config.whatsapp} onChange={e => setConfig({ ...config, whatsapp: e.target.checked })} />Enviar também pelo WhatsApp configurado</label>
      <div className="grid gap-3 sm:grid-cols-3"><label className="rotulo">Recompensa por avaliação<select className="campo mt-1" value={config.jogoId ?? ""} onChange={e => setConfig({ ...config, jogoId: e.target.value || null })}><option value="">Sem recompensa</option>{painel.jogos.map(j => <option key={j.id} value={j.id}>1 jogada · {j.nome}</option>)}</select></label>
        <label className="rotulo">Prazo para avaliar (dias)<input className="campo mt-1" type="number" min={1} max={90} required value={config.validadeDias} onChange={e => setConfig({ ...config, validadeDias: Number(e.target.value) })} /></label>
        <label className="rotulo">Validade da jogada (dias)<input className="campo mt-1" type="number" min={1} max={365} required value={config.recompensaValidadeDias} onChange={e => setConfig({ ...config, recompensaValidadeDias: Number(e.target.value) })} /></label>
      </div>
      <p className="text-sm text-zinc-600">No jogo escolhido, a primeira visita libera uma jogada somente após avaliar. Recompensas de aniversário, indicação e outras visitas continuam seguindo as regras dos jogos.</p>
      {painel.falhasWhatsApp > 0 && <div className="space-y-2"><p role="status" className="text-sm text-amber-700">{painel.falhasWhatsApp} falha(s) no histórico de envio. O convite continua disponível no aplicativo. Confira a entrega em Conversas.</p><button type="button" className="btn text-sm" disabled={salvando} onClick={reenviar}>Tentar novamente envios impedidos por falta de template</button><p className="text-xs text-zinc-500">Configure primeiro o template do WhatsApp. Apenas falhas que comprovam que a mensagem não saiu serão repetidas; falhas incertas permanecem para conferência.</p></div>}
      <button className="btn-primario" disabled={salvando}>{salvando ? "Salvando…" : "Salvar regras"}</button>
    </form>}
  </section>;
}
