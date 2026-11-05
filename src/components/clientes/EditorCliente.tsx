"use client";
import { useRef, useState } from "react";
import { api } from "@/lib/cliente-api";
import { dadosFormularioCliente } from "@/lib/clientes/gestao-form";
import type { CadastroCliente } from "./tipos";

export function EditorCliente({ cliente, aoSalvar, aoCancelar }: {
  cliente?: CadastroCliente; aoSalvar: (id: string) => void; aoCancelar: () => void;
}) {
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const bloqueio = useRef(false);
  async function salvar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (bloqueio.current) return;
    const corpo = dadosFormularioCliente(new FormData(e.currentTarget), cliente);
    if (cliente && Object.keys(corpo).length === 0) { aoCancelar(); return; }
    bloqueio.current = true; setSalvando(true); setErro("");
    try {
      const salvo = await api<CadastroCliente>(`/api/clientes/gestao${cliente ? `/${cliente.id}` : ""}`, { method: cliente ? "PATCH" : "POST", body: corpo });
      aoSalvar(salvo.id);
    } catch (e) { setErro((e as Error).message); }
    finally { bloqueio.current = false; setSalvando(false); }
  }
  // Na edição, o servidor valida só o delta; HTML não deve bloquear e-mail legado intocado.
  return <form onSubmit={salvar} noValidate={Boolean(cliente)} className="space-y-4">
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="rotulo">Nome<input className="campo mt-1" name="nome" autoComplete="name" required maxLength={60} defaultValue={cliente?.nome} /></label>
      <label className="rotulo">Telefone com DDD<input className="campo mt-1" name="telefone" type="tel" autoComplete="tel" required maxLength={30} readOnly={cliente?.temAcesso} defaultValue={cliente?.telefone} /></label>
      <label className="rotulo">E-mail<input className="campo mt-1" name="email" type="email" autoComplete="email" spellCheck={false} maxLength={254} defaultValue={cliente?.email ?? ""} /></label>
      <label className="rotulo">{cliente?.cpfMascarado ? `CPF cadastrado: ${cliente.cpfMascarado}` : "CPF"}<input className="campo mt-1" name="cpf" inputMode="numeric" autoComplete="off" maxLength={20} placeholder={cliente?.cpfMascarado ? "Preencha somente para substituir…" : "000.000.000-00"} /></label>
      <label className="rotulo">Data de nascimento<input className="campo mt-1" name="dataNascimento" type="date" autoComplete="bday" defaultValue={cliente?.dataNascimento ?? ""} /></label>
      <label className="rotulo sm:col-span-2">Endereço completo<textarea className="campo mt-1" name="endereco" autoComplete="street-address" maxLength={300} rows={2} defaultValue={cliente?.endereco ?? ""} /></label>
      <label className="rotulo sm:col-span-2">Observações de atendimento<textarea className="campo mt-1" name="observacoes" maxLength={1000} rows={3} defaultValue={cliente?.observacoes ?? ""} /></label>
    </div>
    {cliente?.temAcesso && <p className="text-xs text-zinc-500">O telefone está vinculado ao acesso do cliente. Para alterá-lo, é necessária a verificação do titular.</p>}
    {!cliente && <p className="text-xs text-zinc-500">O cadastro não cria uma senha nem autoriza mensagens promocionais.</p>}
    {erro && <p role="alert" className="text-sm text-red-600">{erro}</p>}
    <div className="flex gap-2"><button className="btn-primario" disabled={salvando}>{salvando ? "Salvando…" : "Salvar cadastro"}</button><button type="button" className="btn" disabled={salvando} onClick={aoCancelar}>Voltar</button></div>
  </form>;
}
