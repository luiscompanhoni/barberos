"use client";
import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { api } from "@/lib/cliente-api";
import { formatarTelefone } from "@/lib/telefone";
import { EditorCliente } from "./EditorCliente";
import { dataCliente, type DetalheCliente } from "./tipos";

export function ClienteDetalhe({ id, aoVoltar, aoSalvar }: { id: string; aoVoltar: () => void; aoSalvar: () => void }) {
  const [dados, setDados] = useState<DetalheCliente | null>(null);
  const [erro, setErro] = useState("");
  const [editar, setEditar] = useState(false);
  const [revisao, setRevisao] = useState(0);
  useEffect(() => {
    let ativo = true;
    api<DetalheCliente>(`/api/clientes/gestao/${encodeURIComponent(id)}`).then(r => { if (ativo) setDados(r); }).catch(e => { if (ativo) setErro(e.message); });
    return () => { ativo = false; };
  }, [id, revisao]);
  if (erro) return <div className="cartao space-y-3"><p role="alert">{erro}</p><button className="btn" onClick={() => { setErro(""); setRevisao(v => v + 1); }}>Tentar novamente</button><button className="btn" onClick={aoVoltar}>Voltar à lista</button></div>;
  if (!dados) return <p role="status">Carregando cadastro…</p>;
  const c = dados.cliente;
  if (editar) return <section className="cartao space-y-4"><h2 className="text-xl font-semibold">Editar {c.nome}</h2><EditorCliente cliente={c} aoCancelar={() => setEditar(false)} aoSalvar={() => { setDados(null); setEditar(false); setRevisao(v => v + 1); aoSalvar(); }} /></section>;
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><button className="btn" onClick={aoVoltar}>← Todos os clientes</button><button className="btn-primario" onClick={() => setEditar(true)}>Editar cadastro</button></div>
    <section className="cartao space-y-4">
      <div className="flex items-center gap-3">{c.fotoVersao > 0 && <Image unoptimized src={`/api/clientes/gestao/${c.id}/foto?v=${c.fotoVersao}`} alt={`Foto de ${c.nome}`} width={64} height={64} className="h-16 w-16 rounded-full object-cover" />}<div><h2 className="text-2xl font-semibold">{c.nome}</h2><p className="text-sm text-zinc-500">Cliente desde {dataCliente(c.criadoEm)} · {c.cadastroCompleto ? "Cadastro completo" : "Cadastro a completar"}</p></div></div>
      <dl className="grid gap-4 text-sm sm:grid-cols-2">
        {[ ["Telefone", formatarTelefone(c.telefone)], ["E-mail", c.email], ["CPF", c.cpfMascarado], ["Nascimento", c.dataNascimento ? dataCliente(`${c.dataNascimento}T12:00:00Z`) : null], ["Endereço", c.endereco], ["Observações", c.observacoes] ].map(([nome, valor]) => <div key={nome}><dt className="text-zinc-500">{nome}</dt><dd className="mt-1 break-words whitespace-pre-wrap">{valor || "Não informado"}</dd></div>)}
      </dl>
    </section>
    <div className="grid gap-4 sm:grid-cols-2"><div className="cartao"><span className="text-sm text-zinc-500">Atendimentos concluídos</span><p className="numero-kpi">{dados.atendimentos}</p></div><div className="cartao"><span className="text-sm text-zinc-500">Faltas registradas</span><p className="numero-kpi">{dados.faltas}</p></div></div>
    <section className="cartao space-y-3"><div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold">Planos e assinaturas</h3><Link className="underline" href={`/assinaturas?cliente=${encodeURIComponent(c.nome)}`}>Gerenciar assinaturas</Link></div>
      {dados.assinaturas.length ? dados.assinaturas.map(a => <p key={a.id} className="flex flex-wrap justify-between gap-2 border-t border-zinc-200 pt-3"><span>{a.plano.nome}</span><span className="text-sm text-zinc-500">{a.status.replaceAll("_", " ")}</span></p>) : <p className="text-sm text-zinc-500">Nenhuma assinatura registrada.</p>}
    </section>
    <section className="cartao space-y-3"><h3 className="font-semibold">Histórico e próximos horários</h3><p className="text-xs text-zinc-500">Até 20 horários registrados no BarberOS.</p>
      {dados.agendamentos.length ? <ul className="divide-y divide-zinc-200">{dados.agendamentos.map(a => <li key={a.id} className="flex flex-wrap justify-between gap-2 py-3"><span>{dataCliente(a.inicio)} · {[a.servico.nome, ...a.adicionais.map(item => item.servico.nome)].join(" + ")}<small className="block text-zinc-500">{a.barbeiro.nome}</small></span><span className="text-xs text-zinc-500">{a.status.replaceAll("_", " ")}</span></li>)}</ul> : <p className="text-sm text-zinc-500">Nenhum horário registrado.</p>}
    </section>
  </div>;
}
