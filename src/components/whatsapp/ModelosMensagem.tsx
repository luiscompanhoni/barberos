"use client";

import { useCallback, useEffect, useState } from "react";
import { FileText, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { api } from "@/lib/cliente-api";

type Modelo = { id: string; nome: string; status: string; categoria: string; idioma: string; texto: string; motivo: string | null };

const STATUS: Record<string, { texto: string; cor: string }> = {
  APPROVED: { texto: "Aprovado", cor: "text-emerald-600" },
  PENDING: { texto: "Em análise", cor: "text-amber-700" },
  REJECTED: { texto: "Rejeitado", cor: "text-red-600" },
  PAUSED: { texto: "Pausado", cor: "text-amber-700" },
  DISABLED: { texto: "Desativado", cor: "text-red-600" },
};
const CATEGORIA: Record<string, string> = { UTILITY: "Utilidade", MARKETING: "Marketing", AUTHENTICATION: "Autenticação" };

/** Quantas variáveis {{n}} o texto usa (para pedir um exemplo de cada, como a Meta exige). */
const variaveis = (t: string) => Math.max(0, ...[...t.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])));

/** Modelos de mensagem da conta oficial: a Meta revisa cada um antes de liberar o envio. */
export function ModelosMensagem() {
  const [modelos, setModelos] = useState<Modelo[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [nome, setNome] = useState("");
  const [categoria, setCategoria] = useState<"UTILITY" | "MARKETING">("UTILITY");
  const [texto, setTexto] = useState("");
  const [exemplos, setExemplos] = useState<string[]>([]);
  const n = variaveis(texto);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      setModelos((await api<{ modelos: Modelo[] }>("/api/whatsapp/modelos")).modelos);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, []);
  useEffect(() => {
    api<{ modelos: Modelo[] }>("/api/whatsapp/modelos").then((r) => setModelos(r.modelos)).catch((e: Error) => setErro(e.message));
  }, []);

  async function executar(f: () => Promise<unknown>) {
    setOcupado(true);
    setErro(null);
    try {
      await f();
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  function criar(ev: React.FormEvent) {
    ev.preventDefault();
    executar(async () => {
      await api("/api/whatsapp/modelos", { method: "POST", body: { nome, categoria, texto, exemplos: exemplos.slice(0, n) } });
      setNome(""); setTexto(""); setExemplos([]);
    });
  }

  function apagar(m: Modelo) {
    if (!confirm(`Apagar o modelo "${m.nome}" na Meta? O nome fica bloqueado por 30 dias.`)) return;
    executar(() => api(`/api/whatsapp/modelos?nome=${encodeURIComponent(m.nome)}`, { method: "DELETE" }));
  }

  return (
    <section className="cartao space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold"><FileText size={18} className="text-ouro" /> Modelos de mensagem</h2>
        <button className="text-zinc-500" onClick={() => executar(async () => {})} disabled={ocupado} aria-label="Atualizar lista">
          {ocupado ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />}
        </button>
      </div>
      <p className="text-sm text-zinc-500">Avisos fora da janela de 24 h só saem com modelo aprovado pela Meta. A análise costuma levar minutos.</p>

      {modelos === null && !erro && <p className="text-sm text-zinc-500">Carregando…</p>}
      {modelos?.length === 0 && <p className="text-sm text-zinc-500">Nenhum modelo ainda.</p>}
      <ul className="divide-y divide-zinc-200 text-sm">
        {modelos?.map((m) => (
          <li key={m.id} className="flex items-start gap-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="font-medium">{m.nome} <span className="text-xs text-zinc-500">· {CATEGORIA[m.categoria] ?? m.categoria} · {m.idioma}</span></p>
              <p className={`text-xs font-semibold ${STATUS[m.status]?.cor ?? "text-zinc-500"}`}>{STATUS[m.status]?.texto ?? m.status}{m.motivo ? ` (${m.motivo})` : ""}</p>
              <p className="whitespace-pre-wrap break-words text-zinc-600">{m.texto}</p>
            </div>
            <button className="text-red-600" onClick={() => apagar(m)} disabled={ocupado} aria-label={`Apagar ${m.nome}`}><Trash2 size={16} /></button>
          </li>
        ))}
      </ul>

      <form onSubmit={criar} className="space-y-2 border-t border-zinc-200 pt-3">
        <h3 className="text-sm font-semibold">Novo modelo</h3>
        <label className="rotulo">Nome (minúsculas, números e _)
          <input className="campo mt-1 w-full" value={nome} onChange={(e) => setNome(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))} placeholder="lembrete_horario" required maxLength={512} />
        </label>
        <label className="rotulo">Categoria
          <select className="campo mt-1 w-full" value={categoria} onChange={(e) => setCategoria(e.target.value as "UTILITY" | "MARKETING")}>
            <option value="UTILITY">Utilidade (avisos de horário, pagamento)</option>
            <option value="MARKETING">Marketing (promoções, campanhas)</option>
          </select>
        </label>
        <label className="rotulo">Texto (use {"{{1}}"}, {"{{2}}"}… para partes que mudam)
          <textarea className="campo mt-1 w-full" rows={3} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Olá {{1}}! Seu horário é amanhã às {{2}}." required maxLength={1024} />
        </label>
        {Array.from({ length: n }, (_, i) => (
          <label key={i} className="rotulo">Exemplo para {`{{${i + 1}}}`}
            <input className="campo mt-1 w-full" value={exemplos[i] ?? ""} required maxLength={200}
              onChange={(e) => setExemplos((x) => { const c = [...x]; c[i] = e.target.value; return c; })} />
          </label>
        ))}
        <button className="btn-primario" disabled={ocupado}><Plus size={16} /> Enviar para a Meta aprovar</button>
      </form>
      {erro && <p className="text-sm text-red-600">{erro}</p>}
    </section>
  );
}
