"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/cliente-api";
import { formatarTelefone } from "@/lib/telefone";

export function PerfilTela() {
  const [p, setP] = useState<{ nome: string; telefone: string; observacoes: string | null } | null>(null);
  const [nome, setNome] = useState("");
  const [obs, setObs] = useState("");
  const [msg, setMsg] = useState<{ texto: string; erro?: boolean } | null>(null);

  useEffect(() => {
    api<{ nome: string; telefone: string; observacoes: string | null }>("/api/cliente/perfil")
      .then((r) => { setP(r); setNome(r.nome); setObs(r.observacoes ?? ""); })
      .catch((e) => setMsg({ texto: e.message, erro: true }));
  }, []);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (nome.trim().length < 2) return setMsg({ texto: "Digite seu nome.", erro: true });
    try {
      await api("/api/cliente/perfil", { method: "PATCH", body: { nome: nome.trim(), observacoes: obs.trim() } });
      setMsg({ texto: "Salvo." });
    } catch (e) {
      setMsg({ texto: (e as Error).message, erro: true });
    }
  }

  if (!p) return <p className="text-sm text-zinc-500">{msg?.texto ?? "Carregando..."}</p>;
  return (
    <form onSubmit={salvar} className="cartao space-y-3">
      <h1 className="text-lg font-semibold">Seu perfil</h1>
      <div>
        <label className="rotulo">Celular</label>
        <p className="text-sm">{formatarTelefone(p.telefone)}</p>
      </div>
      <div>
        <label className="rotulo" htmlFor="nome">Nome</label>
        <input id="nome" className="campo" value={nome} onChange={(e) => { setNome(e.target.value); setMsg(null); }} />
      </div>
      <div>
        <label className="rotulo" htmlFor="obs">Preferências de corte (o barbeiro vê isso)</label>
        <textarea id="obs" className="campo min-h-24" maxLength={300} placeholder="Ex.: máquina 2 nas laterais, tesoura em cima"
          value={obs} onChange={(e) => { setObs(e.target.value); setMsg(null); }} />
      </div>
      {msg && <p className={`text-sm ${msg.erro ? "text-red-600" : "text-emerald-700"}`}>{msg.texto}</p>}
      <button className="btn-primario">Salvar</button>
    </form>
  );
}
