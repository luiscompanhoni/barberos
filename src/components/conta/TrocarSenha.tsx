"use client";

import { useEffect, useState } from "react";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import { api } from "@/lib/cliente-api";

type Conta = { login: string | null; temSenha: boolean; trocarSenha: boolean; telefone: string };

/** Criar/trocar a propria senha (e o usuario, na equipe). Usado na equipe (/conta) e no perfil do cliente. */
export function TrocarSenha({ equipe, destaque }: { equipe: boolean; destaque?: boolean }) {
  const [conta, setConta] = useState<Conta | null>(null);
  const [f, setF] = useState({ atual: "", nova: "", confirma: "", login: "" });
  const [ver, setVer] = useState(false);
  const [msg, setMsg] = useState<{ texto: string; erro?: boolean } | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    api<Conta>("/api/auth/minha-senha").then((c) => { setConta(c); setF((x) => ({ ...x, login: c.login ?? "" })); }).catch(() => {});
  }, []);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (f.nova && f.nova !== f.confirma) return setMsg({ texto: "A confirmação não bate com a nova senha.", erro: true });
    if (!f.nova && (!equipe || f.login === (conta?.login ?? ""))) return setMsg({ texto: "Digite a nova senha.", erro: true });
    setSalvando(true);
    try {
      await api("/api/auth/minha-senha", {
        method: "PATCH",
        body: { atual: f.atual || null, ...(f.nova ? { nova: f.nova } : {}), ...(equipe ? { login: f.login || null } : {}) },
      });
      setMsg({ texto: f.nova ? "Senha salva. Use ela no próximo login." : "Usuário salvo." });
      setF({ atual: "", nova: "", confirma: "", login: f.login });
      setConta(await api<Conta>("/api/auth/minha-senha"));
    } catch (e) {
      setMsg({ texto: (e as Error).message, erro: true });
    } finally {
      setSalvando(false);
    }
  }

  if (!conta) return null;
  const precisa = !conta.temSenha || conta.trocarSenha;
  const tipo = ver ? "text" : "password";
  return (
    <form id="senha" onSubmit={salvar} className={`${destaque || precisa ? "cartao-destaque" : "cartao"} scroll-mt-20 space-y-3`}>
      <div className="flex items-center gap-2">
        <KeyRound size={18} className="text-ouro" />
        <h2 className="font-semibold">{conta.temSenha && !conta.trocarSenha ? "Trocar senha" : "Crie sua senha"}</h2>
      </div>
      {precisa && (
        <p className="text-sm text-zinc-500">
          {conta.trocarSenha ? "Você entrou com uma senha temporária. Crie a sua para continuar." : "Crie uma senha para entrar das próximas vezes com celular e senha."}
        </p>
      )}
      {equipe && (
        <div>
          <label className="rotulo" htmlFor="s-login">Usuário (opcional: entre com ele ou com o celular)</label>
          <input id="s-login" className="campo" autoComplete="username" placeholder="ex.: ygor" value={f.login} onChange={(e) => setF({ ...f, login: e.target.value })} />
        </div>
      )}
      {conta.temSenha && (
        <div>
          <label className="rotulo" htmlFor="s-atual">{conta.trocarSenha ? "Senha temporária" : "Senha atual"}</label>
          <input id="s-atual" type={tipo} className="campo" autoComplete="current-password" value={f.atual} onChange={(e) => setF({ ...f, atual: e.target.value })} />
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="rotulo" htmlFor="s-nova">Nova senha</label>
          <input id="s-nova" type={tipo} className="campo" autoComplete="new-password" placeholder="mínimo 8 caracteres" value={f.nova} onChange={(e) => setF({ ...f, nova: e.target.value })} />
        </div>
        <div>
          <label className="rotulo" htmlFor="s-conf">Repita a nova senha</label>
          <input id="s-conf" type={tipo} className="campo" autoComplete="new-password" value={f.confirma} onChange={(e) => setF({ ...f, confirma: e.target.value })} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primario" disabled={salvando}>{salvando ? "Salvando..." : "Salvar"}</button>
        <button type="button" className="flex items-center gap-1 text-xs text-zinc-500" onClick={() => setVer(!ver)}>
          {ver ? <EyeOff size={13} /> : <Eye size={13} />} {ver ? "Esconder" : "Mostrar"} senhas
        </button>
        {msg && <span className={`text-sm ${msg.erro ? "text-red-600" : "text-emerald-700"}`}>{msg.texto}</span>}
      </div>
    </form>
  );
}
