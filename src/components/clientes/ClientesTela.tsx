"use client";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, UserRoundPlus, UsersRound } from "lucide-react";
import { api } from "@/lib/cliente-api";
import { formatarTelefone } from "@/lib/telefone";
import { ClienteDetalhe } from "./ClienteDetalhe";
import { EditorCliente } from "./EditorCliente";
import { dataCliente, type ListaClientes } from "./tipos";

export function ClientesTela() {
  const router = useRouter();
  const parametros = useSearchParams();
  const busca = parametros.get("busca") ?? "";
  const plano = parametros.get("plano") ?? "todos";
  const pagina = Math.max(1, Number(parametros.get("pagina")) || 1);
  const id = parametros.get("id");
  const [dados, setDados] = useState<ListaClientes | null>(null);
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [novo, setNovo] = useState(false);
  const [revisao, setRevisao] = useState(0);
  useEffect(() => {
    let ativo = true;
    api<ListaClientes>(`/api/clientes/gestao?${new URLSearchParams({ busca, plano, pagina: String(pagina) })}`).then(r => { if (ativo) { setDados(r); setErro(""); } }).catch(e => { if (ativo) setErro(e.message); }).finally(() => { if (ativo) setCarregando(false); });
    return () => { ativo = false; };
  }, [busca, plano, pagina, revisao]);
  function navegar(mudancas: Record<string, string | null>) {
    const p = new URLSearchParams(parametros.toString());
    Object.entries(mudancas).forEach(([k, v]) => v ? p.set(k, v) : p.delete(k));
    if (!("id" in mudancas)) setCarregando(true);
    if (p.toString() === parametros.toString()) setRevisao(v => v + 1);
    router.replace(`/clientes?${p.toString()}`, { scroll: false });
  }
  if (novo) return <section className="cartao max-w-3xl space-y-5"><h1 className="text-2xl font-semibold">Novo cliente</h1><EditorCliente aoCancelar={() => setNovo(false)} aoSalvar={novoId => { setNovo(false); setRevisao(v => v + 1); navegar({ id: novoId }); }} /></section>;
  if (id) return <ClienteDetalhe key={id} id={id} aoVoltar={() => navegar({ id: null })} aoSalvar={() => setRevisao(v => v + 1)} />;
  return <div className="space-y-5">
    <header className="flex flex-wrap items-center justify-between gap-4"><div><p className="eyebrow">Relacionamento</p><h1 className="flex items-center gap-2 text-2xl font-semibold"><UsersRound aria-hidden="true" /> Clientes</h1><p className="mt-1 text-sm text-zinc-500">Cadastros, planos e histórico de atendimento em um só lugar.</p></div><button className="btn-primario flex items-center gap-2" onClick={() => setNovo(true)}><UserRoundPlus size={18} aria-hidden="true" /> Novo cliente</button></header>
    <form className="cartao flex flex-wrap items-end gap-3" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); navegar({ busca: String(f.get("busca") ?? "").trim() || null, plano: String(f.get("plano")), pagina: null }); }}>
      <label className="min-w-0 flex-1 rotulo">Buscar cliente<input key={busca} name="busca" type="search" className="campo mt-1" maxLength={100} defaultValue={busca} placeholder="Nome, telefone, e-mail ou CPF…" /></label>
      <label className="rotulo">Assinatura<select key={plano} name="plano" className="campo mt-1" defaultValue={plano}><option value="todos">Todos</option><option value="com_plano">Com plano ativo ou atrasado</option><option value="sem_plano">Sem plano ativo ou atrasado</option></select></label>
      <button className="btn flex items-center gap-2"><Search size={16} aria-hidden="true" /> Buscar</button>
    </form>
    <p className="text-sm text-zinc-500" role="status">{carregando ? "Carregando clientes…" : `${dados?.total ?? 0} clientes encontrados`}</p>
    {erro ? <div className="cartao space-y-2"><p role="alert" className="text-red-600">{erro}</p><button className="btn" onClick={() => { setCarregando(true); setRevisao(v => v + 1); }}>Tentar novamente</button></div> : dados && <>
      <div className="grid gap-3 md:grid-cols-2">{dados.clientes.map(c => <button key={c.id} className="cartao-clicavel min-w-0 text-left" onClick={() => navegar({ id: c.id })}>
        <div className="flex items-start justify-between gap-2"><h2 className="break-words font-semibold">{c.nome}</h2><span className="shrink-0 text-xs text-zinc-500">Ver cadastro →</span></div>
        <p className="mt-1 text-sm text-zinc-500">{formatarTelefone(c.telefone)}</p>
        <p className="mt-3 text-sm">{c.assinatura ? `${c.assinatura.plano.nome} · ${c.assinatura.status.toLowerCase()}` : "Sem assinatura atual"}</p>
        <p className="mt-1 text-xs text-zinc-500">{c.ultimaVisita ? `Último atendimento: ${dataCliente(c.ultimaVisita)}` : "Sem atendimento concluído registrado"} · {c.cadastroCompleto ? "Cadastro completo" : "Cadastro a completar"}</p>
      </button>)}</div>
      {!dados.clientes.length && <p className="cartao text-sm text-zinc-500">Nenhum cliente encontrado. Ajuste a busca ou cadastre um novo cliente.</p>}
      <nav aria-label="Páginas de clientes" className="flex items-center justify-between gap-3"><button className="btn" disabled={pagina <= 1 || carregando} onClick={() => navegar({ pagina: String(pagina - 1) })}>Anterior</button><span className="text-sm text-zinc-500">Página {dados.pagina} de {dados.paginas}</span><button className="btn" disabled={pagina >= dados.paginas || carregando} onClick={() => navegar({ pagina: String(pagina + 1) })}>Próxima</button></nav>
    </>}
  </div>;
}
