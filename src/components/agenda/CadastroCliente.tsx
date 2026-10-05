"use client";

import { useState } from "react";
import { api } from "@/lib/cliente-api";
import { OPCOES_ORIGEM } from "@/components/cliente/PerfilTela";

type Dados = { dataNascimento: string | null; origem: string | null; origemDetalhe: string | null };

/** Equipe completa nascimento e "como conheceu" (alimenta idade media, aniversario e canais). */
export function CadastroCliente({ clienteId, inicial }: { clienteId: string; inicial: Dados }) {
  const [f, setF] = useState({ nascimento: inicial.dataNascimento ?? "", origem: inicial.origem ?? "", detalhe: inicial.origemDetalhe ?? "" });
  const [aberto, setAberto] = useState(!inicial.dataNascimento || !inicial.origem);
  const [msg, setMsg] = useState<{ texto: string; erro?: boolean } | null>(null);
  const rotulo = OPCOES_ORIGEM.find(([v]) => v === f.origem)?.[1];

  async function salvar() {
    try {
      await api(`/api/clientes/${clienteId}`, {
        method: "PATCH",
        body: { dataNascimento: f.nascimento || null, origem: f.origem || null, origemDetalhe: f.detalhe.trim() || null },
      });
      setMsg({ texto: "Cadastro salvo." });
      setAberto(false);
    } catch (e) {
      setMsg({ texto: (e as Error).message, erro: true });
    }
  }

  if (!aberto) {
    return (
      <p className="mt-2 text-xs text-zinc-500">
        {f.nascimento && `Nascimento ${f.nascimento.split("-").reverse().join("/")}`}
        {f.nascimento && rotulo && " · "}
        {rotulo && `Conheceu por: ${rotulo}${f.detalhe ? ` (${f.detalhe})` : ""}`}
        {" "}<button className="underline" onClick={() => setAberto(true)}>editar</button>
        {msg && <span className={msg.erro ? "text-red-600" : "text-emerald-700"}> {msg.texto}</span>}
      </p>
    );
  }
  return (
    <div className="mt-3 space-y-2 rounded-lg border border-zinc-200 p-3">
      <p className="text-xs font-semibold text-zinc-600">Completar cadastro (opcional)</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <input type="date" aria-label="Data de nascimento" className="campo" value={f.nascimento} onChange={(e) => setF({ ...f, nascimento: e.target.value })} />
        <select aria-label="Como conheceu" className="campo" value={f.origem} onChange={(e) => setF({ ...f, origem: e.target.value })}>
          <option value="">Como conheceu?</option>
          {OPCOES_ORIGEM.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
        </select>
      </div>
      {f.origem === "INDICACAO" && <input className="campo" placeholder="Quem indicou?" value={f.detalhe} onChange={(e) => setF({ ...f, detalhe: e.target.value })} />}
      <div className="flex items-center gap-2">
        <button className="btn py-1 text-xs" onClick={salvar}>Salvar</button>
        {msg && <span className={`text-xs ${msg.erro ? "text-red-600" : "text-emerald-700"}`}>{msg.texto}</span>}
      </div>
    </div>
  );
}
