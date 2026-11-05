"use client";

import { useEffect, useRef, useState } from "react";
import { api, reais } from "@/lib/cliente-api";
import { instanteLocal } from "@/lib/agenda/tempo";
import type { ListaPedidos, PedidoResumo } from "@/components/cliente/pedidos-tipos";
import type { PreviaPedido } from "@/lib/agenda/pedidos-previa";
import { PreviaPedidoAgendamento } from "./PreviaPedidoAgendamento";

export function PedidosAgendamento() {
  const [dados, setDados] = useState<ListaPedidos | null>(null), [erro, setErro] = useState("");
  const [selecionado, setSelecionado] = useState<PedidoResumo | null>(null);
  const [profissional, setProfissional] = useState(""), [data, setData] = useState(""), [hora, setHora] = useState("");
  const [conferido, setConferido] = useState(false), [ocupado, setOcupado] = useState(false), [aviso, setAviso] = useState("");
  const [avulso, setAvulso] = useState(false), [revisao, setRevisao] = useState(0);
  const [respostaPrevia, setRespostaPrevia] = useState<{ chave: string; valor?: PreviaPedido; erro?: string } | null>(null);
  const trava = useRef(false);
  const consultaId = useRef(0);
  const consulta = consultaPrevia(selecionado?.id, profissional, data, hora);
  const chavePrevia = `${consulta}&revisao=${revisao}`;
  const atual = respostaPrevia?.chave === chavePrevia ? respostaPrevia : null;
  const previa = atual?.valor;
  useEffect(() => {
    if (!consulta) return;
    let ativo = true;
    api<PreviaPedido>(`/api/pedidos-agendamento/previa?${consulta}`)
      .then(valor => { if (ativo) setRespostaPrevia({ chave: chavePrevia, valor }); })
      .catch(e => { if (ativo) setRespostaPrevia({ chave: chavePrevia, erro: e.message }); });
    return () => { ativo = false; };
  }, [consulta, chavePrevia]);
  async function carregar() {
    const id = ++consultaId.current;
    setErro("");
    try { const d = await api<ListaPedidos>("/api/pedidos-agendamento"); if (id === consultaId.current) setDados(d); }
    catch (e) { if (id === consultaId.current) setErro((e as Error).message); }
  }
  useEffect(() => {
    let ativo = true;
    const id = ++consultaId.current;
    api<ListaPedidos>("/api/pedidos-agendamento").then(d => { if (ativo && id === consultaId.current) setDados(d); }).catch(e => { if (ativo && id === consultaId.current) setErro(e.message); });
    return () => { ativo = false; };
  }, []);
  function abrir(p: PedidoResumo) {
    setSelecionado(p); setProfissional(p.barbeiro?.id ?? ""); setData(p.dataPreferida); setHora(p.horaPreferida); setConferido(false); setAvulso(false); setRevisao(n => n + 1); setErro(""); setAviso("");
  }
  async function decidir(acao: "aprovar" | "recusar") {
    if (!selecionado || trava.current || (acao === "aprovar" && (!conferido || !previa || (previa.requerAvulso && !avulso) || !profissional || !data || !hora))) return;
    trava.current = true; setOcupado(true); setErro("");
    try {
      const [h, m] = hora.split(":").map(Number);
      await api("/api/pedidos-agendamento", { method: "PATCH", body: acao === "recusar" ? { id: selecionado.id, acao } : {
        id: selecionado.id, acao, barbeiroId: profissional, inicio: new Date(instanteLocal(data, h * 60 + m, "America/Sao_Paulo")).toISOString(), conferido: true,
        precoEsperadoCentavos: previa!.precoCentavos, duracaoEsperadaMin: previa!.duracaoMin, forcarAvulso: avulso && previa!.requerAvulso,
      } });
      setSelecionado(null); setAviso(acao === "aprovar" ? "Pedido aprovado e horário registrado na agenda do BarberOS." : "Pedido recusado. A resposta está disponível no aplicativo do cliente.");
      await carregar();
    } catch (e) { setErro((e as Error).message); setConferido(false); setAvulso(false); setRevisao(n => n + 1); }
    finally { trava.current = false; setOcupado(false); }
  }
  const compativeis = dados?.profissionais.filter(b => selecionado?.servicos.every(s => b.servicos.some(x => x.servicoId === s.id)) && (!selecionado?.barbeiro || selecionado.barbeiro.id === b.id)) ?? [];

  return <section className="cartao mb-5 space-y-4 p-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold">Pedidos de agendamento</h2><p className="mt-1 text-sm text-zinc-500">Confira a agenda principal antes de confirmar. Nenhum pedido reserva um horário sozinho.</p></div><button type="button" className="btn" disabled={ocupado} onClick={carregar}>Atualizar pedidos</button></div>
    {erro && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{erro}</p>}
    {aviso && <p role="status" className="text-sm text-emerald-700">{aviso}</p>}
    {!dados ? <p className="text-sm">{erro ? "Não foi possível carregar. Use Atualizar pedidos para tentar novamente." : "Carregando pedidos…"}</p> : !dados.pedidos.length ? <p className="text-sm text-zinc-500">Nenhum pedido aguardando conferência.</p> : <div className="grid gap-3 lg:grid-cols-2">{dados.pedidos.map(p => <article className="rounded-xl border border-zinc-200 p-4" key={p.id}>
      <p className="font-semibold">{p.cliente?.nome}</p><p className="text-xs text-zinc-500">{p.cliente?.telefone}</p>
      <p className="mt-2 text-sm">{p.servicos.map(s => s.nome).join(" + ")}</p>
      <p className="text-xs text-zinc-500">{p.servicos.reduce((n, s) => n + s.duracaoMin, 0)} min · {reais(p.servicos.reduce((n, s) => n + s.precoCentavos, 0))} de tabela; plano e profissional podem alterar o valor.</p>
      <p className="mt-2 text-sm">Preferência: {p.dataPreferida.split("-").reverse().join("/")} às {p.horaPreferida} · {p.barbeiro?.nome ?? "Qualquer profissional"}</p>
      {p.observacao && <p className="mt-2 text-sm text-zinc-600">{p.observacao}</p>}
      <button type="button" className="btn mt-3" disabled={ocupado} onClick={() => abrir(p)}>Conferir pedido de {p.cliente?.nome}</button>
    </article>)}</div>}
    {selecionado && <form className="cartao-destaque space-y-4 p-4" onSubmit={e => { e.preventDefault(); void decidir("aprovar"); }}>
      <h3 className="font-semibold">Conferência de {selecionado.cliente?.nome}</h3>
      <p className="text-sm">Se ajustar a preferência, combine o novo horário com o cliente antes de confirmar. Registre também na agenda principal durante a transição.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <label><span className="rotulo">Profissional</span><select required disabled={ocupado} value={profissional} onChange={e => { setProfissional(e.target.value); setConferido(false); setAvulso(false); }} className="campo mt-2"><option value="">Selecione</option>{compativeis.map(b => <option key={b.id} value={b.id}>{b.nome}</option>)}</select></label>
        <label><span className="rotulo">Data confirmada</span><input type="date" required disabled={ocupado} value={data} onChange={e => { setData(e.target.value); setConferido(false); setAvulso(false); }} className="campo mt-2" /></label>
        <label><span className="rotulo">Hora confirmada</span><input type="time" required disabled={ocupado} value={hora} onChange={e => { setHora(e.target.value); setConferido(false); setAvulso(false); }} className="campo mt-2" /></label>
      </div>
      {previa ? <PreviaPedidoAgendamento previa={previa} /> : consulta && <p role={atual?.erro ? "alert" : "status"} className="text-sm">{atual?.erro ?? "Calculando valor e duração com este profissional…"}</p>}
      {atual?.erro && <button type="button" className="btn" disabled={ocupado} onClick={() => { setConferido(false); setAvulso(false); setRevisao(n => n + 1); }}>Atualizar prévia</button>}
      {previa?.requerAvulso && <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={avulso} disabled={ocupado} onChange={e => { setAvulso(e.target.checked); setConferido(false); }} />O cliente concordou com os serviços avulsos e o total de {reais(previa.precoCentavos)} mostrado acima.</label>}
      <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={conferido} disabled={ocupado || !previa || (previa.requerAvulso && !avulso)} onChange={e => setConferido(e.target.checked)} />Conferi o intervalo completo no Cash Barber/agenda principal e confirmei valor, serviços e horário com o cliente.</label>
      <div className="flex flex-wrap gap-3"><button className="btn-primario" disabled={ocupado || !conferido || !previa || (previa.requerAvulso && !avulso)}>Confirmar e registrar horário</button><button type="button" className="btn" disabled={ocupado} onClick={() => decidir("recusar")}>Recusar pedido</button><button type="button" className="btn" disabled={ocupado} onClick={() => setSelecionado(null)}>Fechar conferência</button></div>
    </form>}
  </section>;
}

function consultaPrevia(id: string | undefined, barbeiroId: string, data: string, hora: string) {
  if (!id || !barbeiroId || !/^\d{4}-\d{2}-\d{2}$/.test(data) || !/^\d{2}:\d{2}$/.test(hora)) return "";
  try {
    const [h, m] = hora.split(":").map(Number);
    const inicio = new Date(instanteLocal(data, h * 60 + m, "America/Sao_Paulo")).toISOString();
    return new URLSearchParams({ id, barbeiroId, inicio }).toString();
  } catch { return ""; }
}
