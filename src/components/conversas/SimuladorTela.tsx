"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/cliente-api";

type Msg = { id: string; autor: string; texto: string; criadoEm: string };

const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

/**
 * Faz de conta que e o celular de um cliente: as mensagens passam pelo mesmo
 * caminho do webhook do WhatsApp (bot, agenda, avisos), sem conta na Meta.
 */
export function SimuladorTela({ semChave }: { semChave: boolean }) {
  const [telefone, setTelefone] = useState("(11) 97777-0000");
  const [nome, setNome] = useState("Cliente Teste");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [estado, setEstado] = useState("BOT");
  const [texto, setTexto] = useState("");
  const [esperando, setEsperando] = useState(false);
  const [erro, setErro] = useState("");
  const fim = useRef<HTMLDivElement>(null);

  const carregar = useCallback(async () => {
    try {
      const r = await api<{ estado: string; mensagens: Msg[] }>(`/api/simulador?telefone=${encodeURIComponent(telefone)}`);
      setMsgs(r.mensagens);
      setEstado(r.estado);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [telefone]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- busca inicial
    carregar();
    const es = new EventSource("/api/eventos");
    es.onmessage = (ev) => JSON.parse(ev.data).tipo === "conversa" && carregar();
    return () => es.close();
  }, [carregar]);
  useEffect(() => {
    fim.current?.scrollIntoView({ block: "end" });
  }, [msgs.length, esperando]);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    const t = texto.trim();
    if (!t) return;
    setErro("");
    setTexto("");
    setMsgs((m) => [...m, { id: `tmp${Date.now()}`, autor: "CLIENTE", texto: t, criadoEm: new Date().toISOString() }]);
    setEsperando(true);
    try {
      await api("/api/simulador", { method: "POST", body: { telefone, nomePerfil: nome, texto: t } });
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEsperando(false);
      carregar();
    }
  }

  async function recomecar() {
    await api(`/api/simulador?telefone=${encodeURIComponent(telefone)}`, { method: "DELETE" });
    carregar();
  }

  const visiveis = msgs.filter((m) => m.autor !== "NOTA");

  return (
    <div className="mx-auto grid max-w-4xl gap-4 md:grid-cols-[1fr_360px]">
      <div className="space-y-3">
        <div className="cartao space-y-2 text-sm">
          <h1 className="font-semibold">Simulador do WhatsApp</h1>
          <p className="text-zinc-600">
            Converse como se fosse um cliente. As mensagens passam pelo mesmo caminho do WhatsApp de verdade: o bot consulta e
            marca na agenda real, e a conversa aparece em Conversas.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="rotulo">Celular do cliente</label>
              <input className="campo" value={telefone} onChange={(e) => setTelefone(e.target.value)} />
            </div>
            <div>
              <label className="rotulo">Nome no perfil do WhatsApp</label>
              <input className="campo" value={nome} onChange={(e) => setNome(e.target.value)} />
            </div>
          </div>
          {semChave && (
            <p className="rounded-lg bg-red-50 p-2 text-red-800">
              ANTHROPIC_API_KEY não configurada no .env: o bot não consegue responder e passa toda conversa para a equipe.
            </p>
          )}
          <button className="btn" onClick={recomecar}>Recomeçar conversa</button>
          {estado === "HUMANO" && (
            <p className="rounded-lg bg-amber-50 p-2 text-amber-900">
              Esta conversa esta com a equipe: o bot não responde até alguém devolver em Conversas.
            </p>
          )}
        </div>
        <div className="cartao text-xs text-zinc-500">
          Sugestoes: &quot;oi, quanto ta o corte?&quot; · &quot;tem horário amanhã a tarde com o Pedro?&quot; · &quot;quero remarcar&quot; · &quot;quero falar com alguém&quot;
        </div>
      </div>

      <div className="flex h-[640px] flex-col overflow-hidden rounded-3xl border-8 border-zinc-300 bg-[#0b141a]">
        <div className="bg-[#202c33] px-4 py-2 text-sm font-medium text-zinc-900">Barbearia</div>
        <div className="flex-1 space-y-2 overflow-y-auto p-3">
          {visiveis.map((m) => (
            <div key={m.id} className={`flex ${m.autor === "CLIENTE" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-lg px-2.5 py-1.5 text-sm shadow-sm ${m.autor === "CLIENTE" ? "bg-[#005c4b]" : "bg-[#202c33]"}`}>
                <p className="whitespace-pre-wrap">{m.texto}</p>
                <p className="text-right text-[10px] text-zinc-500">{hora(m.criadoEm)}</p>
              </div>
            </div>
          ))}
          {esperando && <p className="text-xs text-zinc-500">digitando...</p>}
          <div ref={fim} />
        </div>
        <form onSubmit={enviar} className="flex gap-2 bg-[#202c33] p-2">
          <input className="campo rounded-full" placeholder="Mensagem" value={texto} onChange={(e) => setTexto(e.target.value)} />
          <button className="btn-primario rounded-full" disabled={esperando}>Enviar</button>
        </form>
        {erro && <p className="bg-red-50 p-2 text-xs text-red-700">{erro}</p>}
      </div>
    </div>
  );
}
