"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Modal } from "@/components/Modal";
import { api, ErroApi } from "@/lib/cliente-api";
import { MAX_ETIQUETAS_SERVICO, zEtiquetasServico, type EtiquetaServico, type EtiquetasServicoResposta } from "@/lib/servicos/etiquetas";
import { EtiquetasServico } from "./EtiquetasServico";

type Rascunho = EtiquetaServico & { chave: string };
const rascunhos = (itens: EtiquetaServico[]): Rascunho[] => itens.map(item => ({ ...item, chave: crypto.randomUUID() }));

export function EditorEtiquetasServico({ id, nome, aoFechar, aoSalvar }: { id: string; nome: string; aoFechar: () => void; aoSalvar: () => void }) {
  const [etiquetas, setEtiquetas] = useState<Rascunho[]>([]);
  const [versao, setVersao] = useState<number | null>(null);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [conflito, setConflito] = useState(false);
  const [recarregar, setRecarregar] = useState(0);

  useEffect(() => {
    let ativo = true;
    api<EtiquetasServicoResposta>(`/api/servicos/${id}/etiquetas`).then(dados => {
      if (!ativo) return;
      setEtiquetas(rascunhos(dados.etiquetas)); setVersao(dados.versao); setConflito(false);
    }).catch(e => { if (ativo) setErro(e.message); }).finally(() => { if (ativo) setCarregando(false); });
    return () => { ativo = false; };
  }, [id, recarregar]);

  const editar = (chave: string, dados: Partial<EtiquetaServico>) => setEtiquetas(atual => atual.map(item => item.chave === chave ? { ...item, ...dados } : item));
  const simples = etiquetas.map(({ texto, cor, formato }) => ({ texto, cor, formato }));
  const previa = zEtiquetasServico.safeParse(simples);
  const carregarAtual = () => { setErro(""); setCarregando(true); setRecarregar(n => n + 1); };

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (salvando || versao === null) return;
    const validacao = zEtiquetasServico.safeParse(simples);
    if (!validacao.success) return setErro(validacao.error.issues[0]?.message ?? "Confira as etiquetas.");
    setErro(""); setSalvando(true);
    try {
      await api(`/api/servicos/${id}/etiquetas`, { method: "PATCH", body: { etiquetas: validacao.data, versao } });
      aoSalvar();
    } catch (e) {
      setConflito(e instanceof ErroApi && e.codigo === "etiquetas_desatualizadas");
      setErro((e as Error).message);
    } finally { setSalvando(false); }
  }

  return <Modal titulo={`Etiquetas · ${nome}`} onFechar={() => { if (!salvando) aoFechar(); }}>
    <form onSubmit={salvar} className="space-y-4" aria-busy={carregando || salvando}>
      <p className="text-sm text-zinc-500">Personalize texto, cor e formato. As etiquetas também aparecem na escolha de serviços do cliente.</p>
      {erro && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</p>}
      {carregando ? <p role="status">Carregando etiquetas...</p> : versao === null ? <button type="button" className="btn" onClick={carregarAtual}>Tentar carregar novamente</button> : <>
        <fieldset disabled={salvando || conflito} className="space-y-3">
          <legend className="sr-only">Editar etiquetas do serviço</legend>
          {etiquetas.map((item, i) => <fieldset key={item.chave} className="space-y-3 rounded-lg border border-zinc-200 p-3">
            <legend className="px-1 text-sm font-semibold">Etiqueta {i + 1}</legend>
            <div><label className="rotulo" htmlFor={`texto-${item.chave}`}>Texto</label>
              <input id={`texto-${item.chave}`} className="campo" value={item.texto} onChange={e => editar(item.chave, { texto: e.target.value })} maxLength={40} required /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="rotulo" htmlFor={`cor-${item.chave}`}>Cor</label>
                <input id={`cor-${item.chave}`} type="color" className="h-11 w-full rounded border border-zinc-300" value={/^#[0-9a-f]{6}$/i.test(item.cor) ? item.cor : "#F9CB30"} onChange={e => editar(item.chave, { cor: e.target.value })} />
                <label className="sr-only" htmlFor={`hex-${item.chave}`}>Código hexadecimal da etiqueta {i + 1}</label>
                <input id={`hex-${item.chave}`} className="campo mt-2 font-mono" value={item.cor} onChange={e => editar(item.chave, { cor: e.target.value })} maxLength={7} pattern="#[0-9a-fA-F]{6}" required aria-describedby="formato-cor-etiqueta" /></div>
              <div><label className="rotulo" htmlFor={`formato-${item.chave}`}>Formato</label>
                <select id={`formato-${item.chave}`} className="campo" value={item.formato} onChange={e => editar(item.chave, { formato: e.target.value as EtiquetaServico["formato"] })}>
                  <option value="PILULA">Cápsula</option><option value="ARREDONDADA">Arredondado</option><option value="RETANGULAR">Retangular</option>
                </select></div>
            </div>
            <button type="button" className="btn min-h-11 text-sm" aria-label={`Remover etiqueta ${i + 1}`} onClick={() => setEtiquetas(atual => atual.filter(x => x.chave !== item.chave))}><Trash2 size={15} aria-hidden="true" /> Remover</button>
          </fieldset>)}
          <p id="formato-cor-etiqueta" className="text-xs text-zinc-500">Use uma cor como #F9CB30. A cor do texto se ajusta para manter a leitura.</p>
          <button type="button" className="btn min-h-11" disabled={etiquetas.length >= MAX_ETIQUETAS_SERVICO} onClick={() => setEtiquetas(atual => [...atual, { chave: crypto.randomUUID(), texto: "", cor: "#F9CB30", formato: "PILULA" }])}><Plus size={16} aria-hidden="true" /> Adicionar etiqueta</button>
          <p className="text-xs text-zinc-500">Até {MAX_ETIQUETAS_SERVICO} etiquetas por serviço, com até 40 caracteres cada.</p>
        </fieldset>
        <section aria-label="Prévia das etiquetas" className="rounded-lg border border-zinc-200 p-3">
          <h3 className="text-sm font-semibold">Prévia</h3>
          {previa.success && previa.data.length ? <EtiquetasServico etiquetas={previa.data} /> : <p className="mt-2 text-xs text-zinc-500">{etiquetas.length ? "Preencha as etiquetas para visualizar." : "Este serviço está sem etiquetas."}</p>}
        </section>
        {conflito && <button type="button" className="btn min-h-11" onClick={carregarAtual}>Descartar rascunho e carregar versão atual</button>}
        <div className="flex flex-wrap gap-2">
          <button className="btn-primario min-h-11" disabled={salvando || conflito}>{salvando ? "Salvando..." : "Salvar etiquetas"}</button>
          <button type="button" className="btn min-h-11" disabled={salvando} onClick={aoFechar}>Cancelar</button>
        </div>
      </>}
    </form>
  </Modal>;
}
