"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/cliente-api";
import { formatarTelefone } from "@/lib/telefone";
import { TrocarSenha } from "@/components/conta/TrocarSenha";
import { CADASTRO_VAZIO, CamposCadastroCompleto, type DadosCadastroForm } from "./CamposCadastroCompleto";
import { FotoPerfil } from "./FotoPerfil";
import { alteracoesPerfil } from "@/lib/clientes/perfil-form";

type Perfil = { nome: string; telefone: string; cpfMascarado: string | null; email: string | null; endereco: string | null;
  observacoes: string | null; dataNascimento: string | null; origem: string | null; origemDetalhe: string | null; fotoVersao: number; completo: boolean };
export const OPCOES_ORIGEM: [string, string][] = [
  ["INDICACAO", "Indicação de alguém"], ["INSTAGRAM", "Instagram"], ["GOOGLE", "Google / Maps"],
  ["FACHADA", "Passei na frente"], ["WHATSAPP", "WhatsApp"], ["OUTRO", "Outro"],
];

export function PerfilTela() {
  const [p, setP] = useState<Perfil | null>(null), [f, setF] = useState<DadosCadastroForm>(CADASTRO_VAZIO);
  const [extras, setExtras] = useState({ obs: "", origem: "", detalhe: "" });
  const [pendente, setPendente] = useState(""), [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<{ texto: string; erro?: boolean } | null>(null);
  const trava = useRef(false);
  useEffect(() => {
    let ativo = true;
    api<Perfil>("/api/cliente/perfil").then((r) => {
      if (!ativo) return; setP(r);
      setF({ nome: r.nome, telefone: r.telefone, cpf: "", email: r.email ?? "", endereco: r.endereco ?? "", dataNascimento: r.dataNascimento ?? "" });
      setExtras({ obs: r.observacoes ?? "", origem: r.origem ?? "", detalhe: r.origemDetalhe ?? "" });
    }).catch((e) => { if (ativo) setMsg({ texto: e.message, erro: true }); });
    api<{ pendente: boolean; provedor?: string }>("/api/auth/social/concluir").then((r) => { if (ativo && r.pendente) setPendente(r.provedor ?? ""); }).catch(() => {});
    return () => { ativo = false; };
  }, []);
  function campo(k: keyof DadosCadastroForm, v: string) { setF((f) => ({ ...f, [k]: v })); setMsg(null); }
  async function salvar(e: React.FormEvent) {
    e.preventDefault(); if (trava.current || !p) return; trava.current = true; setOcupado(true); setMsg(null);
    try {
      const body = alteracoesPerfil(p, f, extras);
      if (!Object.keys(body).length) { setMsg({ texto: "Não há alterações para salvar." }); return; }
      await api("/api/cliente/perfil", { method: "PATCH", body });
      const novo = await api<Perfil>("/api/cliente/perfil"); setP(novo);
      setF({ nome: novo.nome, telefone: novo.telefone, cpf: "", email: novo.email ?? "", endereco: novo.endereco ?? "", dataNascimento: novo.dataNascimento ?? "" });
      setExtras({ obs: novo.observacoes ?? "", origem: novo.origem ?? "", detalhe: novo.origemDetalhe ?? "" });
      setMsg({ texto: "Cadastro salvo." });
    } catch (e) { setMsg({ texto: (e as Error).message, erro: true }); }
    finally { trava.current = false; setOcupado(false); }
  }
  async function vincular() {
    if (trava.current) return; trava.current = true; setOcupado(true); setMsg(null);
    try { await api("/api/auth/social/concluir", { method: "PATCH", body: { confirmar: true } }); setPendente(""); setMsg({ texto: "Acesso conectado. Você poderá usá-lo no próximo login." }); }
    catch (e) { setMsg({ texto: (e as Error).message, erro: true }); }
    finally { trava.current = false; setOcupado(false); }
  }
  if (!p) return <p role={msg?.erro ? "alert" : "status"} className="text-sm text-zinc-500">{msg?.texto ?? "Carregando…"}</p>;
  return <div className="entrar-suave space-y-5">
    <div><p className="eyebrow">Sua conta</p><h1 className="titulo-marca mt-3 text-4xl">Seu <span className="text-ouro">perfil.</span></h1></div>
    {!p.completo && <p className="cartao text-sm">Complete seus dados para manter seu cadastro atualizado. A foto é opcional.</p>}
    {pendente && <div className="cartao space-y-3"><p className="text-sm">Conectar o acesso {pendente} à conta de <b>{p.nome}</b> ({formatarTelefone(p.telefone)})?</p>
      <button type="button" className="btn" disabled={ocupado} onClick={() => void vincular()}>Confirmar conexão do acesso</button><Link href="/c/entrar?social=pendente" className="block text-sm text-ouro underline">Confirmar meu celular por código</Link></div>}
    <FotoPerfil versaoInicial={p.fotoVersao} nome={p.nome} />
    <form onSubmit={salvar} noValidate className="space-y-5">
      <fieldset disabled={ocupado} className="cartao space-y-4">
        <div><p className="rotulo">Celular</p><p className="text-sm">{formatarTelefone(p.telefone)}</p><p className="text-xs text-zinc-500">Para trocar o número de acesso, fale com a recepção.</p></div>
        <div><label className="rotulo" htmlFor="perfil-nome">Nome completo</label><input id="perfil-nome" autoComplete="name" required className="campo-linha" value={f.nome} onChange={(e) => campo("nome", e.target.value)} /></div>
        {p.cpfMascarado && <p className="text-xs text-zinc-500">CPF cadastrado: {p.cpfMascarado}</p>}
        <CamposCadastroCompleto identidade={false} obrigatorios={false} cpfExistente={Boolean(p.cpfMascarado)} valor={f} mudar={campo} />
        <div><label className="rotulo" htmlFor="perfil-obs">Preferências de corte</label><textarea id="perfil-obs" className="campo min-h-24" maxLength={300} placeholder="Ex.: máquina 2 nas laterais, tesoura em cima" value={extras.obs} onChange={(e) => setExtras((f) => ({ ...f, obs: e.target.value }))} /></div>
        <div><label className="rotulo" htmlFor="perfil-origem">Como conheceu a barbearia?</label>
          <select id="perfil-origem" className="campo" value={extras.origem} onChange={(e) => setExtras((f) => ({ ...f, origem: e.target.value }))}>
            <option value="">Escolha…</option>{OPCOES_ORIGEM.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
          </select>
          {extras.origem === "INDICACAO" && <><label htmlFor="perfil-indicacao" className="rotulo mt-3">Quem indicou?</label><input id="perfil-indicacao" className="campo-linha" maxLength={80} value={extras.detalhe} onChange={(e) => setExtras((f) => ({ ...f, detalhe: e.target.value }))} /></>}
        </div>
      </fieldset>
      {msg && <p role={msg.erro ? "alert" : "status"} className={`text-sm ${msg.erro ? "text-red-600" : "text-emerald-700"}`}>{msg.texto}</p>}
      <button className="btn-primario w-full py-3" disabled={ocupado}>{ocupado ? "Salvando…" : "Salvar cadastro"}</button>
    </form>
    <TrocarSenha equipe={false} />
    <Link href="/c/privacidade" className="cartao-clicavel block text-sm"><b className="block text-zinc-900">Meus dados e privacidade</b><span className="text-zinc-500">Baixar seus dados, mensagens de divulgação e excluir a conta</span></Link>
  </div>;
}
