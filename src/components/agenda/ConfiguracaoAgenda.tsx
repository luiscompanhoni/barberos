"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
import { api } from "@/lib/cliente-api";

type Dados = {
  cadeiras: { id: string; nome: string; ativa: boolean }[];
  barbeiros: { id: string; nome: string; cadeiraId: string | null }[];
  servicos: { id: string; nome: string; duracaoMin: number; minimoDuracaoMin: number; barbeiros: { barbeiroId: string; duracaoMin: number | null; minimoDuracaoMin: number | null }[] }[];
};
export function ConfiguracaoAgenda(p: { onFechar: () => void }) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [nome, setNome] = useState("");
  const [servicoId, setServicoId] = useState("");
  const [barbeiroId, setBarbeiroId] = useState("");
  const [minutos, setMinutos] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => { api<Dados>("/api/agenda/configuracao").then(setDados).catch(e => setMensagem(e.message)); }, []);
  async function salvar(body: unknown) {
    setOcupado(true); setMensagem("");
    try { setDados(await api<Dados>("/api/agenda/configuracao", { method: "PATCH", body })); setMensagem("Configuração salva. Reservas existentes mantêm seus dados."); }
    catch (e) { setMensagem((e as Error).message); } finally { setOcupado(false); }
  }
  async function cadeira(body: { id?: string; nome: string; ativa: boolean }) {
    setOcupado(true); setMensagem("");
    try { await api("/api/cadeiras", { method: "POST", body }); setDados(await api<Dados>("/api/agenda/configuracao")); setNome(""); setMensagem("Cadeira salva."); }
    catch (e) { setMensagem((e as Error).message); } finally { setOcupado(false); }
  }
  const servico = dados?.servicos.find(s => s.id === servicoId);
  const regra = servico?.barbeiros.find(b => b.barbeiroId === barbeiroId);
  return <Modal titulo="Cadeiras e limites de duração" onFechar={p.onFechar}>
    <div className="space-y-5">
      <p className="text-sm text-zinc-500">Os limites valem para os novos ajustes. Reduzir a duração de uma reserva não muda seu preço.</p>
      {!dados ? <p>Carregando…</p> : <>
        <section className="space-y-2" aria-label="Cadeiras">
          <h3 className="font-semibold">Cadeiras físicas</h3>
          {dados.cadeiras.map(c => <CadeiraLinha key={`${c.id}-${c.nome}`} cadeira={c} ocupado={ocupado} salvar={cadeira} />)}
          <form className="flex gap-2" onSubmit={e => { e.preventDefault(); void cadeira({ nome, ativa: true }); }}><input required aria-label="Nome da nova cadeira" className="campo" maxLength={60} placeholder="Ex.: Cadeira 1" value={nome} onChange={e => setNome(e.target.value)} /><button className="btn" disabled={ocupado}>Adicionar</button></form>
        </section>
        <section className="space-y-2" aria-label="Cadeira padrão por profissional">
          <h3 className="font-semibold">Cadeira padrão</h3>
          {dados.barbeiros.map(b => <label key={b.id} className="rotulo">{b.nome}<select disabled={ocupado} className="campo" value={b.cadeiraId ?? ""} onChange={e => void salvar({ tipo: "cadeira", barbeiroId: b.id, cadeiraId: e.target.value || null })}>
            <option value="">Sem cadeira padrão</option>{dados.cadeiras.filter(c => c.ativa).map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select></label>)}
        </section>
        <form className="space-y-2" onSubmit={e => { e.preventDefault(); void salvar({ tipo: "minimo", servicoId, ...(barbeiroId ? { barbeiroId } : {}), minutos: minutos === "" ? null : Number(minutos) }); }}>
          <h3 className="font-semibold">Duração mínima permitida</h3>
          <label className="rotulo">Serviço<select required className="campo" value={servicoId} onChange={e => { setServicoId(e.target.value); setBarbeiroId(""); setMinutos(""); }}><option value="">Selecione</option>{dados.servicos.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}</select></label>
          {servico && <>
            <label className="rotulo">Regra<select className="campo" value={barbeiroId} onChange={e => { setBarbeiroId(e.target.value); setMinutos(""); }}><option value="">Geral do serviço</option>{servico.barbeiros.map(b => <option key={b.barbeiroId} value={b.barbeiroId}>{dados.barbeiros.find(p => p.id === b.barbeiroId)?.nome ?? "Profissional inativo"}</option>)}</select></label>
            <p className="text-xs text-zinc-500">Padrão: {regra?.duracaoMin ?? servico.duracaoMin} min. Mínimo atual: {regra?.minimoDuracaoMin ?? servico.minimoDuracaoMin} min.</p>
            <label className="rotulo">Novo mínimo (min)<input required={!barbeiroId} className="campo" type="number" min={5} max={regra?.duracaoMin ?? servico.duracaoMin} value={minutos} placeholder={barbeiroId ? "Vazio: usar regra geral" : "Ex.: 20"} onChange={e => setMinutos(e.target.value)} /></label>
            <button className="btn-primario" disabled={ocupado}>Salvar limite</button>
          </>}
        </form>
      </>}
      {mensagem && <p role="status" className="text-sm">{mensagem}</p>}
    </div>
  </Modal>;
}

function CadeiraLinha(p: { cadeira: Dados["cadeiras"][number]; ocupado: boolean; salvar: (d: Dados["cadeiras"][number]) => Promise<void> }) {
  const [nome, setNome] = useState(p.cadeira.nome);
  return <form className="flex items-center gap-2" onSubmit={e => { e.preventDefault(); void p.salvar({ ...p.cadeira, nome }); }}>
    <input required maxLength={60} className="campo" aria-label={`Nome de ${p.cadeira.nome}`} value={nome} onChange={e => setNome(e.target.value)} />
    <button className="btn" disabled={p.ocupado}>Salvar</button><button type="button" className="btn" disabled={p.ocupado} onClick={() => void p.salvar({ ...p.cadeira, ativa: !p.cadeira.ativa })}>{p.cadeira.ativa ? "Desativar" : "Ativar"}</button>
  </form>;
}
