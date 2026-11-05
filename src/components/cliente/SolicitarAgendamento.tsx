"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api, reais } from "@/lib/cliente-api";
import { dataLocal, somarDias } from "@/lib/agenda/tempo";
import type { CatalogoPedido, ListaPedidos, PedidoResumo } from "./pedidos-tipos";
import { StatusPedidoAgendamento } from "./StatusPedidoAgendamento";

export function SolicitarAgendamento({ catalogo }: { catalogo: CatalogoPedido }) {
  const [ids, setIds] = useState<string[]>([]), [barbeiroId, setBarbeiro] = useState("");
  const [data, setData] = useState(""), [hora, setHora] = useState(""), [observacao, setObservacao] = useState("");
  const [pedidos, setPedidos] = useState<PedidoResumo[]>([]), [erro, setErro] = useState(""), [aviso, setAviso] = useState("");
  const [carregando, setCarregando] = useState(true), [ocupado, setOcupado] = useState(false);
  const trava = useRef(false), tentativa = useRef<{ chave: string; conteudo: string } | null>(null);
  const consultaId = useRef(0);
  const selecionados = catalogo.servicos.filter(s => ids.includes(s.id));
  const profissionais = selecionados[0]?.barbeiros.filter(b => selecionados.every(s => s.barbeiros.some(p => p.id === b.id))) ?? [];
  const [hoje] = useState(() => dataLocal(Date.now(), "America/Sao_Paulo"));

  async function carregar() {
    const id = ++consultaId.current;
    setCarregando(true); setErro("");
    try { const r = await api<ListaPedidos>("/api/cliente/pedidos-agendamento"); if (id === consultaId.current) setPedidos(r.pedidos); }
    catch (e) { if (id === consultaId.current) setErro((e as Error).message); }
    finally { if (id === consultaId.current) setCarregando(false); }
  }
  useEffect(() => {
    let ativo = true;
    const id = ++consultaId.current;
    api<ListaPedidos>("/api/cliente/pedidos-agendamento").then(r => { if (ativo && id === consultaId.current) setPedidos(r.pedidos); }).catch(e => { if (ativo && id === consultaId.current) setErro(e.message); }).finally(() => { if (ativo && id === consultaId.current) setCarregando(false); });
    return () => { ativo = false; };
  }, []);

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (trava.current || !ids.length || !profissionais.length) return;
    trava.current = true; setOcupado(true); setErro(""); setAviso("");
    const dados = { servicoIds: ids, barbeiroId: barbeiroId || null, dataPreferida: data, horaPreferida: hora, observacao };
    const conteudo = JSON.stringify(dados);
    if (!tentativa.current || tentativa.current.conteudo !== conteudo) tentativa.current = { chave: crypto.randomUUID(), conteudo };
    try {
      await api("/api/cliente/pedidos-agendamento", { method: "POST", body: { ...dados, chave: tentativa.current.chave } });
      tentativa.current = null; setIds([]); setBarbeiro(""); setData(""); setHora(""); setObservacao("");
      setAviso("Pedido enviado à recepção. Aguarde a confirmação: este horário ainda não está reservado.");
      await carregar();
    } catch (e) { setErro((e as Error).message); }
    finally { trava.current = false; setOcupado(false); }
  }
  async function cancelar(id: string) {
    if (trava.current) return;
    trava.current = true; setOcupado(true); setErro("");
    try { await api("/api/cliente/pedidos-agendamento", { method: "PATCH", body: { id, acao: "cancelar" } }); await carregar(); }
    catch (e) { setErro((e as Error).message); }
    finally { trava.current = false; setOcupado(false); }
  }

  return <div className="space-y-6">
    <header><p className="eyebrow">Seu atendimento na Black</p><h1 className="titulo-marca mt-3 text-3xl">Solicitar agendamento</h1>
      <p className="mt-3 text-sm text-zinc-600">Escolha os serviços e sua preferência de horário. A recepção confere a agenda e responde aqui no aplicativo.</p>
      <p className="mt-2 text-sm font-semibold text-ouro">O pedido fica pendente até a confirmação da equipe.</p></header>
    {erro && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{erro}</p>}
    {aviso && <p role="status" className="cartao-destaque p-4 text-sm">{aviso}</p>}
    <form onSubmit={enviar} className="space-y-5">
      <fieldset disabled={ocupado} className="space-y-3"><legend className="rotulo mb-3">1. Escolha um ou mais serviços</legend>
        {catalogo.servicos.map(s => <label key={s.id} className={`cartao-clicavel flex items-center gap-3 p-4 ${ids.includes(s.id) ? "border-ouro" : ""}`}>
          <input type="checkbox" checked={ids.includes(s.id)} onChange={e => { setIds(a => e.target.checked ? [...a, s.id] : a.filter(id => id !== s.id)); setBarbeiro(""); }} />
          <span className="flex-1"><span className="block font-semibold">{s.nome}</span><span className="text-xs text-zinc-500">{s.duracaoMin} min · {reais(s.precoCentavos)}</span></span>
        </label>)}
        {!catalogo.servicos.length && <p className="text-sm">Nenhum serviço disponível no momento.</p>}
      </fieldset>
      {!!selecionados.length && <p className="cartao-destaque p-4 text-sm" aria-live="polite">{selecionados.length} serviço(s) · {selecionados.reduce((n, s) => n + s.duracaoMin, 0)} min · {reais(selecionados.reduce((n, s) => n + s.precoCentavos, 0))} de tabela. Plano e profissional podem alterar o valor final.</p>}
      {ids.length > 10 && <p role="alert" className="text-sm text-red-700">Selecione até 10 serviços.</p>}
      {!!ids.length && !profissionais.length && <p role="alert" className="text-sm text-red-700">Nenhum profissional realiza todos esses serviços. Ajuste a seleção.</p>}
      <label className="block"><span className="rotulo">2. Profissional</span><select className="campo mt-2" value={barbeiroId} disabled={ocupado || !profissionais.length} onChange={e => setBarbeiro(e.target.value)}><option value="">Qualquer profissional disponível</option>{profissionais.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></label>
      <fieldset disabled={ocupado} className="grid grid-cols-2 gap-3"><legend className="rotulo mb-3">3. Sua preferência — sujeita à confirmação</legend>
        <label><span className="rotulo">Data desejada</span><input type="date" className="campo mt-2" value={data} min={hoje} max={somarDias(hoje, catalogo.janelaDias)} required onChange={e => setData(e.target.value)} /></label>
        <label><span className="rotulo">Horário desejado</span><input type="time" className="campo mt-2" value={hora} required onChange={e => setHora(e.target.value)} /></label>
      </fieldset>
      <label className="block"><span className="rotulo">Observação (opcional)</span><textarea className="campo mt-2" value={observacao} maxLength={500} disabled={ocupado} onChange={e => setObservacao(e.target.value)} /></label>
      <button className="btn-primario w-full" disabled={ocupado || !ids.length || ids.length > 10 || !profissionais.length || !data || !hora}>{ocupado ? "Aguarde…" : "Enviar pedido à recepção"}</button>
    </form>
    <section className="space-y-3"><div className="flex items-center justify-between"><h2 className="text-xl font-semibold">Meus pedidos</h2><button type="button" className="btn" onClick={carregar} disabled={carregando || ocupado}>Atualizar</button></div>
      {carregando ? <p role="status" className="text-sm">Carregando pedidos…</p> : !pedidos.length ? <p className="text-sm text-zinc-500">Você ainda não tem pedidos.</p> : pedidos.map(p => <article key={p.id} className="cartao space-y-2 p-4">
        <p className="font-semibold">{p.servicos.map(s => s.nome).join(" + ")}</p>
        <p className="text-sm">Preferência: {p.dataPreferida.split("-").reverse().join("/")} às {p.horaPreferida} · {p.barbeiro?.nome ?? "Qualquer profissional"}</p>
        <StatusPedidoAgendamento pedido={p} />
        {p.status === "PENDENTE" && <button type="button" className="btn" disabled={ocupado} onClick={() => cancelar(p.id)}>Cancelar pedido</button>}
      </article>)}
    </section>
    <Link className="btn inline-flex" href="/c">Voltar para meus horários</Link>
  </div>;
}
