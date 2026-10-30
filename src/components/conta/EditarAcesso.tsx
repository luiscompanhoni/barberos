"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
import { api } from "@/lib/cliente-api";
import { FotoAcesso } from "./FotoAcesso";
import { PAPEIS_EQUIPE, type Acesso, type PapelEquipe } from "./acessos-tipos";

type Opcoes = {
  usuario: Acesso;
  servicos: { id: string; nome: string }[];
  permissoes: { chave: string; rotulo: string; detalhe: string; papeis: string[]; base: boolean; excecao: boolean | null }[];
};

export function EditarAcesso({ id, onFechar, onSalvo }: { id: string; onFechar: () => void; onSalvo: () => void }) {
  const [opcoes, setOpcoes] = useState<Opcoes | null>(null);
  const [erro, setErro] = useState("");
  useEffect(() => {
    let vivo = true;
    api<Opcoes>(`/api/usuarios/${id}`).then((r) => { if (vivo) setOpcoes(r); }).catch((e) => { if (vivo) setErro(e.message); });
    return () => { vivo = false; };
  }, [id]);
  return <Modal titulo="Editar cadastro da equipe" onFechar={onFechar}>
    {opcoes ? <Formulario key={id} opcoes={opcoes} onSalvo={onSalvo} /> : <p role="status">{erro || "Carregando cadastro…"}</p>}
  </Modal>;
}

function Formulario({ opcoes, onSalvo }: { opcoes: Opcoes; onSalvo: () => void }) {
  const u = opcoes.usuario;
  const [nome, setNome] = useState(u.nome);
  const [telefone, setTelefone] = useState(u.telefone);
  const [login, setLogin] = useState(u.login ?? "");
  const [papel, setPapel] = useState<PapelEquipe>(u.papel);
  const [ativo, setAtivo] = useState(u.ativo);
  const [atende, setAtende] = useState(u.barbeiro?.ativo ?? false);
  const [cor, setCor] = useState(u.barbeiro?.cor ?? "#d3ab45");
  const [servicoIds, setServicoIds] = useState(u.barbeiro?.servicos.map((s) => s.servicoId) ?? []);
  const [criarCadastroEquipe, setCriarCadastroEquipe] = useState(false);
  const [cargo, setCargo] = useState(u.checklistPessoa?.cargo ?? "");
  const [funcaoChecklist, setFuncaoChecklist] = useState(u.checklistPessoa?.funcao ?? "BARBEIRO");
  const [permissoes, setPermissoes] = useState<Record<string, boolean | null>>(() => Object.fromEntries(opcoes.permissoes.map((p) => [p.chave, p.excecao])));
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const aplicaveis = opcoes.permissoes.filter((p) => p.papeis.includes(papel));
  const incluirCadastroEquipe = !!u.checklistPessoa || atende || criarCadastroEquipe;

  async function salvar(e: React.FormEvent) {
    e.preventDefault(); setOcupado(true); setErro("");
    try {
      await api(`/api/usuarios/${u.id}`, { method: "PATCH", body: {
        acao: "editar", nome, telefone, login: login || null, papel, ativo, atende, cor,
        ...(JSON.stringify(servicoIds) !== JSON.stringify(u.barbeiro?.servicos.map((s) => s.servicoId) ?? [])
          ? { servicoIds: servicoIds.filter((id) => opcoes.servicos.some((s) => s.id === id)) } : {}),
        ...(incluirCadastroEquipe ? { cargo: cargo || null, funcaoChecklist } : {}),
        permissoes: Object.fromEntries(aplicaveis.map((p) => [p.chave, permissoes[p.chave] ?? null])),
      } });
      onSalvo();
    } catch (e) { setErro((e as Error).message); }
    finally { setOcupado(false); }
  }

  return <form onSubmit={salvar} className="space-y-4">
    <p className="text-sm text-zinc-500">Mudar a função mantém os atendimentos, comissões e pontos desta pessoa. As permissões novas valem na próxima ação, inclusive em sessões abertas.</p>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="rotulo">Nome<input className="campo" required minLength={2} maxLength={60} value={nome} onChange={(e) => setNome(e.target.value)} /></label>
      <label className="rotulo">Celular com DDD<input className="campo" required inputMode="tel" maxLength={30} value={telefone} onChange={(e) => setTelefone(e.target.value)} /></label>
      <label className="rotulo">Usuário de acesso<input className="campo" autoComplete="off" maxLength={30} value={login} onChange={(e) => setLogin(e.target.value)} /></label>
      <label className="rotulo">Função<select className="campo" value={papel} disabled={u.eu} onChange={(e) => setPapel(e.target.value as PapelEquipe)}>{Object.entries(PAPEIS_EQUIPE).map(([k, nome]) => <option key={k} value={k}>{nome}</option>)}</select></label>
    </div>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ativo} disabled={u.eu} onChange={(e) => setAtivo(e.target.checked)} /> Acesso ativo <span className="text-xs text-zinc-500">(desativado perde o login, a agenda e o checklist)</span></label>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={atende} onChange={(e) => setAtende(e.target.checked)} /> Também atende como barbeiro e aparece na agenda</label>
    {u.eu && <p className="text-xs text-zinc-500">Outro dono deve alterar sua função ou desativar seu acesso.</p>}
    {atende && <fieldset className="space-y-2 rounded-xl border border-zinc-200 p-3">
      <legend className="px-1 text-sm font-semibold">Agenda e serviços</legend>
      <label className="flex items-center gap-3 text-sm">Cor na agenda<input type="color" value={cor} onChange={(e) => setCor(e.target.value)} /></label>
      <div className="grid gap-2 sm:grid-cols-2">{opcoes.servicos.map((s) => <label key={s.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={servicoIds.includes(s.id)} onChange={(e) => setServicoIds((ids) => e.target.checked ? [...ids, s.id] : ids.filter((id) => id !== s.id))} />{s.nome}</label>)}</div>
      {!opcoes.servicos.length && <p className="text-xs text-zinc-500">Cadastre serviços em Equipe e serviços.</p>}
      {!u.barbeiro && <p className="text-xs text-zinc-500">Depois de salvar, configure o expediente e a foto deste profissional.</p>}
    </fieldset>}
    {!u.checklistPessoa && <div className="space-y-1">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={incluirCadastroEquipe} disabled={atende} onChange={(e) => setCriarCadastroEquipe(e.target.checked)} /> Cadastrar também em checklist, RH e presença</label>
      <p className="text-xs text-zinc-500">{atende ? "O cadastro da equipe acompanha quem atende como barbeiro." : "Permite registrar presença e acompanhar tarefas mesmo sem uma agenda de barbeiro."}</p>
    </div>}
    {u.checklistPessoa && <p className="text-xs text-zinc-500">Esta pessoa já está vinculada ao checklist, RH e presença. O vínculo e o histórico serão mantidos.</p>}
    {incluirCadastroEquipe && <div className="grid gap-3 sm:grid-cols-2">
      <label className="rotulo">Cargo no RH<input className="campo" maxLength={80} value={cargo} onChange={(e) => setCargo(e.target.value)} /></label>
      <label className="rotulo">Modelo de checklist<select className="campo" value={funcaoChecklist} onChange={(e) => setFuncaoChecklist(e.target.value as typeof funcaoChecklist)}><option value="BARBEIRO">Barbeiro</option><option value="GERENTE">Gerente / líder</option><option value="DIARISTA">Diarista</option></select><span className="text-xs font-normal text-zinc-500">Define as tarefas; não altera a função de acesso.</span></label>
    </div>}
    <FotoAcesso acesso={u} />
    {!!aplicaveis.length && <fieldset className="space-y-3 rounded-xl border border-zinc-200 p-3">
      <legend className="px-1 text-sm font-semibold">Permissões individuais</legend>
      <p className="text-xs text-zinc-500">“Padrão da função” acompanha a matriz geral. Uma exceção vale somente para esta pessoa.</p>
      {aplicaveis.map((p) => <label key={p.chave} className="block text-sm"><span className="font-medium">{p.rotulo}</span><span className="mb-1 block text-xs text-zinc-500">{p.detalhe}</span><select className="campo" value={permissoes[p.chave] === null ? "padrao" : String(permissoes[p.chave])} onChange={(e) => setPermissoes((v) => ({ ...v, [p.chave]: e.target.value === "padrao" ? null : e.target.value === "true" }))}><option value="padrao">Padrão da função{papel === u.papel ? ` (${p.base ? "permitido" : "negado"})` : ""}</option><option value="true">Permitir para esta pessoa</option><option value="false">Negar para esta pessoa</option></select></label>)}
    </fieldset>}
    {papel === "DONO" && <p className="text-sm text-zinc-500">Donos têm acesso completo. Atribua essa função somente a quem deve administrar todo o sistema.</p>}
    {erro && <p role="alert" className="text-sm text-red-600">{erro}</p>}
    <button className="btn-primario w-full" disabled={ocupado}>{ocupado ? "Salvando…" : "Salvar cadastro e permissões"}</button>
  </form>;
}
