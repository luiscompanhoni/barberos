"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/cliente-api";
import { formatarTelefone } from "@/lib/telefone";

type Perfil = { nome: string; telefone: string; observacoes: string | null; dataNascimento: string | null; origem: string | null; origemDetalhe: string | null };

export const OPCOES_ORIGEM: [string, string][] = [
  ["INDICACAO", "Indicação de alguém"], ["INSTAGRAM", "Instagram"], ["GOOGLE", "Google / Maps"],
  ["FACHADA", "Passei na frente"], ["WHATSAPP", "WhatsApp"], ["OUTRO", "Outro"],
];

export function PerfilTela() {
  const [p, setP] = useState<Perfil | null>(null);
  const [f, setF] = useState({ nome: "", obs: "", nascimento: "", origem: "", detalhe: "" });
  const [msg, setMsg] = useState<{ texto: string; erro?: boolean } | null>(null);

  useEffect(() => {
    api<Perfil>("/api/cliente/perfil")
      .then((r) => {
        setP(r);
        setF({ nome: r.nome, obs: r.observacoes ?? "", nascimento: r.dataNascimento ?? "", origem: r.origem ?? "", detalhe: r.origemDetalhe ?? "" });
      })
      .catch((e) => setMsg({ texto: e.message, erro: true }));
  }, []);

  const campo = (k: keyof typeof f, v: string) => { setF({ ...f, [k]: v }); setMsg(null); };

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (f.nome.trim().length < 2) return setMsg({ texto: "Digite seu nome.", erro: true });
    try {
      await api("/api/cliente/perfil", {
        method: "PATCH",
        body: {
          nome: f.nome.trim(), observacoes: f.obs.trim(),
          dataNascimento: f.nascimento || null, origem: f.origem || null, origemDetalhe: f.detalhe.trim() || null,
        },
      });
      setMsg({ texto: "Salvo." });
    } catch (e) {
      setMsg({ texto: (e as Error).message, erro: true });
    }
  }

  if (!p) return <p className="text-sm text-zinc-500">{msg?.texto ?? "Carregando..."}</p>;
  return (
    <form onSubmit={salvar} className="entrar-suave space-y-5">
      <div>
        <p className="eyebrow">Sua conta</p>
        <h1 className="titulo-marca mt-3 text-4xl">Seu <span className="text-ouro">perfil.</span></h1>
      </div>
      <div className="cartao space-y-4">
        <div>
          <p className="rotulo">Celular</p>
          <p className="text-sm">{formatarTelefone(p.telefone)}</p>
        </div>
        <div>
          <label className="rotulo" htmlFor="nome">Nome</label>
          <input id="nome" className="campo-linha" value={f.nome} onChange={(e) => campo("nome", e.target.value)} />
        </div>
        <div>
          <label className="rotulo" htmlFor="nasc">Data de nascimento</label>
          <input id="nasc" type="date" className="campo-linha" value={f.nascimento} onChange={(e) => campo("nascimento", e.target.value)} />
          <p className="mt-1 text-xs text-zinc-500">No seu aniversário tem surpresa. 🎉</p>
        </div>
        <div>
          <label className="rotulo" htmlFor="obs">Preferências de corte (o barbeiro vê isso)</label>
          <textarea id="obs" className="campo min-h-24" maxLength={300} placeholder="Ex.: máquina 2 nas laterais, tesoura em cima"
            value={f.obs} onChange={(e) => campo("obs", e.target.value)} />
        </div>
        <div>
          <label className="rotulo" htmlFor="origem">Como conheceu a barbearia?</label>
          <select id="origem" className="campo" value={f.origem} onChange={(e) => campo("origem", e.target.value)}>
            <option value="">Escolha...</option>
            {OPCOES_ORIGEM.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
          </select>
          {f.origem === "INDICACAO" && (
            <input className="campo-linha mt-2" placeholder="Quem te indicou?" value={f.detalhe} onChange={(e) => campo("detalhe", e.target.value)} />
          )}
        </div>
      </div>
      {msg && <p className={`text-sm ${msg.erro ? "text-red-600" : "text-emerald-700"}`}>{msg.texto}</p>}
      <button className="btn-primario w-full py-3">Salvar</button>
    </form>
  );
}
