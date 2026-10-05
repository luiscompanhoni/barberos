"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/cliente-api";
import { formatarTelefone } from "@/lib/telefone";

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
  mensagens: { id: string; autor: "CLIENTE" | "BOT" | "EQUIPE" | "SISTEMA" | "NOTA"; texto: string; erro: string | null; criadoEm: string }[];
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
  const fim = useRef<HTMLDivElement>(null);
  const abertaRef = useRef<string | null>(null);

  const carregarLista = useCallback(() => api<Resumo[]>("/api/conversas").then(setLista).catch((e) => setErro(e.message)), []);
  const carregarDetalhe = useCallback((id: string) => api<Detalhe>(`/api/conversas/${id}`).then(setDetalhe).catch((e) => setErro(e.message)), []);

  useEffect(() => {
    carregarLista();
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
    <div className="grid h-[calc(100vh-90px)] gap-3 md:grid-cols-[320px_1fr]">
      <aside className={`cartao overflow-y-auto p-0 ${aberta ? "hidden md:block" : ""}`}>
        {lista.length === 0 && <p className="p-4 text-sm text-zinc-500">Nenhuma conversa ainda.</p>}
        <ul className="divide-y divide-zinc-100">
          {lista.map((c) => (
            <li key={c.id}>
              <button onClick={() => setAberta(c.id)} className={`w-full px-4 py-3 text-left hover:bg-zinc-50 ${aberta === c.id ? "bg-zinc-100" : ""}`}>
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
              <button className="btn md:hidden" onClick={() => setAberta(null)}>‹</button>
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
            <div className="flex-1 space-y-2 overflow-y-auto bg-[#0b141a] p-4">
              {detalhe.mensagens.map((m) =>
                m.autor === "NOTA" ? (
                  <p key={m.id} className="text-center text-[11px] text-zinc-600">{m.texto} · {hora(m.criadoEm)}</p>
                ) : (
                  <div key={m.id} className={`flex ${m.autor === "CLIENTE" ? "justify-start" : "justify-end"}`}>
                    <div className={`max-w-[80%] rounded-lg px-3 py-1.5 text-sm shadow-sm ${m.autor === "CLIENTE" ? "bg-[#202c33]" : m.autor === "BOT" ? "bg-[#005c4b]" : "border border-ouro/40 bg-[#2a2415]"}`}>
                      <p className="whitespace-pre-wrap">{m.texto}</p>
                      <p className="mt-0.5 text-right text-[10px] text-zinc-500">
                        {m.autor === "BOT" ? "Bot" : m.autor === "EQUIPE" ? "Equipe" : m.autor === "SISTEMA" ? "Aviso automático" : ""} {hora(m.criadoEm)}
                        {m.erro && <span className="text-red-600"> · não enviado: {m.erro}</span>}
                      </p>
                    </div>
                  </div>
                ),
              )}
              <div ref={fim} />
            </div>
            <form onSubmit={enviar} className="flex gap-2 border-t border-zinc-200 p-3">
              <input className="campo" placeholder={detalhe.estado === "BOT" ? "Responder (assume a conversa)" : "Escreva uma mensagem"} value={texto} onChange={(e) => setTexto(e.target.value)} />
              <button className="btn-primario">Enviar</button>
            </form>
          </>
        )}
        {erro && <p className="px-4 pb-3 text-sm text-red-600">{erro}</p>}
      </section>
    </div>
  );
}
