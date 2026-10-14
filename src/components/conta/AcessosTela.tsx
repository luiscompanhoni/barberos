"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, KeyRound, Lock, Plus, UsersRound } from "lucide-react";
import { api } from "@/lib/cliente-api";
import { formatarTelefone } from "@/lib/telefone";

type Acesso = { id: string; nome: string; telefone: string; papel: string; login: string | null; ativo: boolean; eu: boolean; temSenha: boolean; trocarSenha: boolean; bloqueado: boolean };
const PAPEL: Record<string, string> = { DONO: "Dono", GERENTE: "Gerente", RECEPCAO: "Recepção", BARBEIRO: "Barbeiro" };

/** Acessos da equipe: senha temporaria, ativar/desativar, papel e novo acesso de recepcao/gerente (so o dono). */
export function AcessosTela() {
  const [lista, setLista] = useState<Acesso[] | null>(null);
  const [temp, setTemp] = useState<{ nome: string; senha: string } | null>(null);
  const [novo, setNovo] = useState({ nome: "", telefone: "", papel: "RECEPCAO" });
  const [msg, setMsg] = useState<{ texto: string; erro?: boolean } | null>(null);

  const carregar = useCallback(() => { api<Acesso[]>("/api/usuarios").then(setLista).catch((e) => setMsg({ texto: e.message, erro: true })); }, []);
  useEffect(carregar, [carregar]);

  async function gerar(a: Acesso) {
    if (a.temSenha && !confirm(`Gerar uma senha temporária nova para ${a.nome}? A senha atual dele para de funcionar.`)) return;
    try {
      const r = await api<{ senha: string }>(`/api/usuarios/${a.id}`, { method: "PATCH", body: { acao: "senha_temporaria" } });
      setTemp({ nome: a.nome, senha: r.senha });
      carregar();
    } catch (e) {
      setMsg({ texto: (e as Error).message, erro: true });
    }
  }

  async function mudarPapel(a: Acesso, papel: string) {
    if (!confirm(`Mudar ${a.nome} de ${PAPEL[a.papel]} para ${PAPEL[papel]}? O acesso muda na hora.`)) return;
    try {
      await api(`/api/usuarios/${a.id}`, { method: "PATCH", body: { acao: "papel", papel } });
      setMsg({ texto: `${a.nome} agora é ${PAPEL[papel]}.` });
      carregar();
    } catch (e) {
      setMsg({ texto: (e as Error).message, erro: true });
    }
  }

  async function adicionar(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api("/api/usuarios", { method: "POST", body: novo });
      setNovo({ nome: "", telefone: "", papel: "RECEPCAO" });
      setMsg({ texto: "Acesso criado. Gere a senha temporária para a pessoa entrar." });
      carregar();
    } catch (e) {
      setMsg({ texto: (e as Error).message, erro: true });
    }
  }

  return (
    <section className="cartao space-y-4">
      <div className="flex items-center gap-2">
        <UsersRound size={18} className="text-ouro" />
        <h2 className="font-semibold">Acessos da equipe</h2>
      </div>
      <p className="text-sm text-zinc-500">
        Cada pessoa entra com o celular (ou usuário) e senha. Gere uma senha temporária e passe para ela; no primeiro acesso ela cria a própria.
        Barbeiros novos são cadastrados em “Equipe e serviços”, logo abaixo. O que o gerente e a recepção podem fazer fica em “Permissões”.
      </p>

      {temp && (
        <div className="cartao-destaque flex flex-wrap items-center gap-3 text-sm">
          <KeyRound size={16} className="text-ouro" />
          <span>Senha temporária de <b>{temp.nome}</b>:</span>
          <code className="rounded bg-zinc-100 px-2 py-1 font-mono text-base">{temp.senha}</code>
          <button className="btn py-1 text-xs" onClick={() => navigator.clipboard?.writeText(temp.senha)}><Copy size={12} /> Copiar</button>
          <span className="w-full text-xs text-zinc-500">Ela só aparece agora. Passe pessoalmente ou por mensagem e peça para trocar no primeiro login.</span>
        </div>
      )}

      {!lista ? <p className="text-sm text-zinc-500">Carregando...</p> : (
        <ul className="divide-y divide-zinc-200 text-sm">
          {lista.map((a) => (
            <li key={a.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 ${a.ativo ? "" : "opacity-50"}`}>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">
                  {a.nome}{" "}
                  {a.eu || a.papel === "BARBEIRO" ? <span className="text-xs font-normal text-zinc-500">· {PAPEL[a.papel] ?? a.papel}{a.eu && " (você)"}</span> : (
                    <select aria-label={`Papel de ${a.nome}`} className="ml-1 rounded-lg border border-zinc-200 bg-transparent px-1.5 py-0.5 text-xs font-normal text-zinc-600" value={a.papel} onChange={(e) => mudarPapel(a, e.target.value)}>
                      <option value="RECEPCAO">Recepção</option>
                      <option value="GERENTE">Gerente</option>
                      <option value="DONO">Dono / sócio</option>
                    </select>
                  )}
                </p>
                <p className="text-xs text-zinc-500">
                  {formatarTelefone(a.telefone)}{a.login && ` · usuário ${a.login}`} ·{" "}
                  {!a.temSenha ? <span className="text-amber-700">sem senha</span> : a.trocarSenha ? <span className="text-amber-700">senha temporária</span> : "senha criada"}
                  {a.bloqueado && <span className="ml-1 text-red-600"><Lock size={10} className="inline" /> bloqueado por tentativas</span>}
                </p>
              </div>
              <button className="btn py-1 text-xs" onClick={() => gerar(a)} disabled={!a.ativo}><KeyRound size={12} /> {a.temSenha ? "Nova senha temporária" : "Gerar senha"}</button>
              <button className="text-xs text-zinc-500 underline" onClick={() => api(`/api/usuarios/${a.id}`, { method: "PATCH", body: { acao: a.ativo ? "desativar" : "ativar" } }).then(carregar).catch((e) => setMsg({ texto: e.message, erro: true }))}>
                {a.ativo ? "desativar" : "reativar"}
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={adicionar} className="grid gap-2 border-t border-zinc-200 pt-3 sm:grid-cols-[1fr_1fr_auto_auto]">
        <input className="campo" placeholder="Nome" value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} />
        <input className="campo" inputMode="tel" placeholder="Celular com DDD" value={novo.telefone} onChange={(e) => setNovo({ ...novo, telefone: e.target.value })} />
        <select className="campo" value={novo.papel} onChange={(e) => setNovo({ ...novo, papel: e.target.value })}>
          <option value="RECEPCAO">Recepção</option>
          <option value="GERENTE">Gerente</option>
          <option value="DONO">Dono / sócio</option>
        </select>
        <button className="btn-primario"><Plus size={14} /> Novo acesso</button>
      </form>
      {msg && <p className={`text-sm ${msg.erro ? "text-red-600" : "text-emerald-700"}`}>{msg.texto}</p>}
    </section>
  );
}
