"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/cliente-api";
import { formatarTelefone } from "@/lib/telefone";
import styles from "./conversas-crm.module.css";
import { NovoContato } from "./NovoContato";

type Resumo = {
  id: string;
  telefone: string;
  nomePerfil: string | null;
  estado: "BOT" | "HUMANO";
  naoLidas: number;
  atualizadoEm: string;
  cliente: { nome: string } | null;
  mensagens: { texto: string; autor: string; criadoEm: string }[];
};
type Detalhe = {
  id: string;
  telefone: string;
  nomePerfil: string | null;
  estado: "BOT" | "HUMANO";
  cliente: { id: string; nome: string } | null;
  mensagens: { id: string; autor: "CLIENTE" | "BOT" | "EQUIPE" | "SISTEMA" | "NOTA"; texto: string; erro: string | null; entregueEm: string | null; lidaEm: string | null; criadoEm: string }[];
};

const nomeDe = (c: { cliente: { nome: string } | null; nomePerfil: string | null; telefone: string }) =>
  c.cliente?.nome || c.nomePerfil || formatarTelefone(c.telefone);
const hora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

/** Conversas do WhatsApp: a equipe acompanha o bot e assume quando precisa. */
export function ConversasTela() {
  const [lista, setLista] = useState<Resumo[]>([]);
  const [aberta, setAberta] = useState<string | null>(null);
  const [detalhe, setDetalhe] = useState<Detalhe | null>(null);
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState("");
  const [busca, setBusca] = useState("");
  const [consulta, setConsulta] = useState("");
  const [novo, setNovo] = useState(false);
  const consultaRef = useRef("");
  const ultimaLista = useRef(0);
  const fim = useRef<HTMLDivElement>(null);
  const abertaRef = useRef<string | null>(null);

  const carregarLista = useCallback(async () => {
    const pedido = ++ultimaLista.current;
    try {
      const r = await api<Resumo[]>(`/api/conversas?busca=${encodeURIComponent(consultaRef.current)}`);
      if (pedido === ultimaLista.current) setLista(r);
    } catch (e) { if (pedido === ultimaLista.current) setErro((e as Error).message); }
  }, []);
  const carregarDetalhe = useCallback((id: string) => api<Detalhe>(`/api/conversas/${id}`).then(setDetalhe).catch((e) => setErro(e.message)), []);

  useEffect(() => { const t = setTimeout(() => setConsulta(busca.trim()), 200); return () => clearTimeout(t); }, [busca]);
  useEffect(() => { consultaRef.current = consulta; carregarLista(); }, [consulta, carregarLista]);

  useEffect(() => {
    const es = new EventSource("/api/eventos");
    es.onmessage = (ev) => {
      const e = JSON.parse(ev.data);
      if (e.tipo !== "conversa") return;
      carregarLista();
      if (e.conversaId === abertaRef.current) carregarDetalhe(e.conversaId);
    };
    return () => es.close();
  }, [carregarLista, carregarDetalhe]);

  useEffect(() => {
    abertaRef.current = aberta;
    if (aberta) carregarDetalhe(aberta);
  }, [aberta, carregarDetalhe]);
  useEffect(() => {
    fim.current?.scrollIntoView({ block: "end" });
  }, [detalhe?.mensagens.length]);

  async function acao(fn: () => Promise<unknown>) {
    setErro("");
    try { await fn(); if (aberta) await carregarDetalhe(aberta); await carregarLista(); } catch (e) { setErro((e as Error).message); }
  }

  const enviar = (e: React.FormEvent) => {
    e.preventDefault();
    if (!aberta || !texto.trim()) return;
    acao(async () => { await api(`/api/conversas/${aberta}/mensagens`, { method: "POST", body: { texto } }); setTexto(""); });
  };

  return (
    <div className={`${styles.grade} grid h-[calc(100vh-90px)] gap-3 md:grid-cols-[320px_1fr]`}>
      {novo && <NovoContato fechar={() => setNovo(false)} criado={id => { setNovo(false); setBusca(""); setAberta(id); void carregarLista(); }} />}
      <aside aria-label="Lista de conversas" className={`cartao overflow-y-auto p-0 ${aberta ? "hidden md:block" : ""}`}>
        <header className={styles.titulo}><p className="eyebrow">Relacionamento</p><h1 className="titulo-marca text-xl">Conversas</h1></header>
        <div className="space-y-2 p-3"><label className="sr-only" htmlFor="busca-conversa">Buscar por nome ou WhatsApp</label><input id="busca-conversa" type="search" className="campo" placeholder="Buscar nome ou WhatsApp" maxLength={100} value={busca} onChange={e => setBusca(e.target.value)} /><button className="btn w-full" onClick={() => setNovo(true)}>+ Adicionar cliente</button></div>
        {lista.length === 0 && <p role="status" className="p-4 text-sm text-zinc-500">{consulta ? "Nenhuma conversa encontrada." : "Nenhuma conversa ainda."}</p>}
        {erro && <p role="alert" className="px-3 text-sm text-red-700">{erro}</p>}
        <ul className="divide-y divide-zinc-100">
          {lista.map((c) => (
            <li key={c.id}>
              <button onClick={() => setAberta(c.id)} aria-pressed={aberta === c.id} className={`${styles.contato} w-full px-4 py-3 text-left hover:bg-zinc-50 ${aberta === c.id ? "bg-zinc-100" : ""}`}>
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold">{nomeDe(c)}</span>
                  {c.estado === "HUMANO" && <span className="rounded bg-amber-100 px-1.5 text-[11px] text-amber-900">Equipe</span>}
                  {c.naoLidas > 0 && <span className="ml-auto rounded-full bg-emerald-600 px-1.5 text-[11px] text-white">{c.naoLidas}</span>}
                </div>
                <p className="truncate text-xs text-zinc-500">{c.mensagens[0]?.texto ?? ""}</p>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className={`cartao flex min-h-0 flex-col p-0 ${aberta ? "" : "hidden md:flex"}`}>
        {!detalhe || detalhe.id !== aberta ? (
          <p className="m-auto text-sm text-zinc-500">Escolha uma conversa.</p>
        ) : (
          <>
            <header className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-4 py-2">
              <button className="btn md:hidden" aria-label="Voltar à lista de conversas" onClick={() => setAberta(null)}>‹</button>
              <div>
                <p className="text-sm font-semibold">{nomeDe(detalhe)}</p>
                <p className="text-xs text-zinc-500">{formatarTelefone(detalhe.telefone)} · {detalhe.estado === "BOT" ? "Bot respondendo" : "Equipe respondendo"}</p>
              </div>
              <div className="ml-auto">
                {detalhe.estado === "BOT" ? (
                  <button className="btn" onClick={() => acao(() => api(`/api/conversas/${detalhe.id}`, { method: "PATCH", body: { estado: "HUMANO" } }))}>Assumir conversa</button>
                ) : (
                  <button className="btn" onClick={() => acao(() => api(`/api/conversas/${detalhe.id}`, { method: "PATCH", body: { estado: "BOT" } }))}>Devolver para o bot</button>
                )}
              </div>
            </header>
            <div className={`${styles.mensagens} flex-1 space-y-2 overflow-y-auto bg-[#0b141a] p-4`}>
              {detalhe.mensagens.map((m) =>
                m.autor === "NOTA" ? (
                  <p key={m.id} className="text-center text-[11px] text-zinc-600">{m.texto} · {hora(m.criadoEm)}</p>
                ) : (
                  <div key={m.id} className={`flex ${m.autor === "CLIENTE" ? "justify-start" : "justify-end"}`}>
                    <div data-autor={m.autor} className={`${styles.balao} max-w-[80%] rounded-lg px-3 py-1.5 text-sm shadow-sm`}>
                      <p className="whitespace-pre-wrap break-words">{m.texto}</p>
                      <p className="mt-0.5 text-right text-[10px] text-zinc-500">
                        {m.autor === "BOT" ? "Bot" : m.autor === "EQUIPE" ? "Equipe" : m.autor === "SISTEMA" ? "Aviso automático" : ""} {hora(m.criadoEm)}
                        {m.autor !== "CLIENTE" && !m.erro && (m.lidaEm ? <span className="text-sky-400" title="Lida"> ✓✓</span> : m.entregueEm ? <span title="Entregue"> ✓✓</span> : null)}
                        {m.erro && <span className="text-red-600"> · não enviado: {m.erro}</span>}
                      </p>
                    </div>
                  </div>
                ),
              )}
              <div ref={fim} />
            </div>
            <form onSubmit={enviar} className="flex gap-2 border-t border-zinc-200 p-3">
              <input className="campo" aria-label="Mensagem para a conversa selecionada" placeholder={detalhe.estado === "BOT" ? "Responder (assume a conversa)" : "Escreva uma mensagem"} value={texto} onChange={(e) => setTexto(e.target.value)} />
              <button className="btn-primario">Enviar</button>
            </form>
          </>
        )}
        {erro && <p className="px-4 pb-3 text-sm text-red-600">{erro}</p>}
      </section>
    </div>
  );
}
