"use client";

import { useRef, useState } from "react";
import { Modal } from "@/components/Modal";
import { api } from "@/lib/cliente-api";

export function NovoContato(p: { fechar: () => void; criado: (id: string) => void }) {
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const trava = useRef(false);
  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (trava.current) return;
    trava.current = true; setOcupado(true); setErro("");
    try {
      const r = await api<{ id: string }>("/api/conversas", { method: "POST", body: { nome, telefone } });
      p.criado(r.id);
    } catch (e) { setErro((e as Error).message); }
    finally { trava.current = false; setOcupado(false); }
  }
  return <Modal titulo="Adicionar cliente pelo WhatsApp" onFechar={p.fechar}><form onSubmit={salvar} className="space-y-4">
    <label className="block text-sm" htmlFor="contato-nome">Nome<input id="contato-nome" autoComplete="name" required minLength={2} maxLength={100} className="campo mt-1" value={nome} onChange={e => setNome(e.target.value)} /></label>
    <label className="block text-sm" htmlFor="contato-telefone">WhatsApp com DDD<input id="contato-telefone" type="tel" autoComplete="tel" required minLength={10} maxLength={30} className="campo mt-1" value={telefone} onChange={e => setTelefone(e.target.value)} /></label>
    <p className="text-xs text-zinc-500">Um número já cadastrado abre o contato existente. Cadastrar não envia mensagem nem autoriza campanhas.</p>
    {erro && <p role="alert" className="text-sm text-red-700">{erro}</p>}
    <button className="btn-primario w-full" disabled={ocupado}>{ocupado ? "Salvando…" : "Salvar e abrir conversa"}</button>
  </form></Modal>;
}
