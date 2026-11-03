"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Bot, CirclePause, RefreshCw } from "lucide-react";
import type { PainelAgentes } from "@/lib/agentes/tipos";
import { ErroApi } from "@/lib/cliente-api";
import { apiAgentes } from "./cliente";
import { Catalogo, Integracoes } from "./Catalogo";
import { Execucoes } from "./Execucoes";
import { NovaTarefa } from "./NovaTarefa";
import { ConfiguracaoAgentes, Rotinas } from "./Rotinas";
import styles from "./agentes-crm.module.css";

const FLUXO = [
  ["Estratégia", "Objetivo, oferta e capacidade"], ["Conteúdo", "Roteiro e direção criativa"],
  ["Aprovação", "Revisão do material"], ["Tráfego", "Planejamento e dados Meta"],
  ["Análise", "Resultados e recomendações"], ["Ajustes", "Nova proposta de melhoria"],
];

export function AgentesTela() {
  const [painel, setPainel] = useState<PainelAgentes | null>(null);
  const [erro, setErro] = useState(""), [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState(false), [carregando, setCarregando] = useState(true);
  const [processando, setProcessando] = useState(false);
  const [aba, setAba] = useState<"trabalhos" | "catalogo" | "rotinas" | "conexoes">("trabalhos");
  const trava = useRef(false), sequencia = useRef(0), montado = useRef(false);
  const processamento = useRef(false);

  const falhou = useCallback((e: unknown) => {
    if (!montado.current) return;
    if (e instanceof ErroApi && [401, 403].includes(e.status)) {
      // Invalida também leituras iniciadas antes da revogação que ainda não terminaram.
      sequencia.current++; setPainel(null); setAviso("");
    }
    setErro(e instanceof Error ? e.message : "Não foi possível atualizar a central.");
  }, []);

  const carregar = useCallback(async () => {
    const seq = ++sequencia.current;
    const dados = await apiAgentes<PainelAgentes>();
    if (montado.current && seq === sequencia.current) setPainel(dados);
  }, []);

  useEffect(() => {
    montado.current = true;
    void carregar().catch(falhou).finally(() => { if (montado.current) setCarregando(false); });
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && !trava.current) void carregar().catch(falhou);
    }, 30_000);
    return () => { montado.current = false; clearInterval(timer); };
  }, [carregar, falhou]);

  async function executar(acao: () => Promise<void>, mensagem: string) {
    if (trava.current) return;
    trava.current = true; setOcupado(true); setErro(""); setAviso("");
    try { await acao(); await carregar(); if (montado.current) setAviso(mensagem); }
    catch (e) { falhou(e); }
    finally { trava.current = false; if (montado.current) setOcupado(false); }
  }

  async function processar() {
    if (processamento.current) return;
    processamento.current = true; setProcessando(true); setErro("");
    try {
      await apiAgentes("/processar", "POST", {});
      await carregar();
      if (montado.current) setAviso("Processamento encerrado. Confira o estado e o resultado na lista.");
    } catch (e) { falhou(e); }
    finally { processamento.current = false; if (montado.current) setProcessando(false); }
  }

  const pendentes = painel?.execucoes.filter(e => e.estado === "PENDENTE").length ?? 0;
  const revisoes = painel?.execucoes.filter(e => e.estado === "AGUARDA_APROVACAO").length ?? 0;
  return <div className="space-y-5" aria-busy={ocupado || carregando}>
    <div className="cabecalho-gestao"><div><p className="eyebrow">Automação da barbearia</p><h1 className="titulo-marca">Agentes da Black</h1><p className="mt-2 max-w-3xl text-sm text-zinc-500">Organize o trabalho repetido, acompanhe os resultados e mantenha as decisões em uma só central.</p></div><button className="btn" disabled={ocupado || carregando} onClick={() => void executar(async () => {}, "Dados atualizados.")}><RefreshCw size={16} aria-hidden="true" /> Atualizar</button></div>
    {erro ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{erro}<p className="mt-1">Use “Atualizar” para conferir o estado antes de repetir uma ação.</p></div> : null}
    {aviso ? <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{aviso}</p> : null}
    {carregando && !painel ? <p role="status" className="cartao py-12 text-center text-zinc-500">Carregando a central…</p> : null}
    {painel ? <>
      <div className="cartao-destaque space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><Bot className="text-ouro" size={26} aria-hidden="true" /><div><h2 className="font-semibold">{painel.catalogo.length} especialistas, um fluxo conectado</h2><p className="mt-1 text-xs text-zinc-500">{pendentes} na fila · {revisoes} para revisar · {painel.rotinas.filter(r => r.ativa).length} rotinas ativas</p></div></div><span className="inline-flex items-center gap-2 text-xs text-zinc-500">{painel.configuracao.pausada ? <CirclePause size={16} aria-hidden="true" /> : null}{painel.configuracao.pausada ? "Central pausada" : painel.execucaoHabilitada ? "Execução habilitada" : "Execução aguarda configuração"}</span></div>
        <ol className={`${styles.fluxo} grid gap-2 sm:grid-cols-3 xl:grid-cols-6`}>{FLUXO.map(([titulo, texto], i) => <li key={titulo} data-crm-reveal className="rounded-xl border border-zinc-200 bg-white/60 p-3"><div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold text-ouro">{String(i + 1).padStart(2, "0")}</span>{i < FLUXO.length - 1 ? <ArrowRight size={13} className="text-zinc-400" aria-hidden="true" /> : null}</div><p className="mt-2 text-sm font-semibold">{titulo}</p><p className="mt-1 text-xs text-zinc-500">{texto}</p></li>)}</ol>
        <p className="text-xs text-zinc-500">Dados pode encaminhar uma revisão para Estratégia, e Estratégia pode preparar Conteúdo automaticamente, em até duas etapas. Conteúdo aguarda revisão antes de seguir para Tráfego. Publicação, impulsionamento e gastos precisam de conexão e aprovação próprias.</p>
      </div>
      {!painel.execucaoHabilitada ? <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-700">As tarefas podem ser preparadas, mas o processamento de IA ainda precisa ser habilitado pelo responsável técnico. Confira as conexões abaixo.</p> : null}
      <div className="flex flex-wrap items-center justify-between gap-3"><nav className="crm-subtabs flex flex-wrap gap-2" aria-label="Seções da central">{([['trabalhos', 'Trabalhos'], ['catalogo', 'Especialistas'], ['rotinas', 'Rotinas'], ['conexoes', 'Conexões']] as const).map(([id, nome]) => <button key={id} className={aba === id ? "btn-primario" : "btn"} aria-pressed={aba === id} onClick={() => setAba(id)}>{nome}</button>)}</nav>
        <div className="flex flex-wrap gap-2"><button className="btn" disabled={ocupado} onClick={() => void executar(async () => { await apiAgentes("", "PATCH", { ...painel.configuracao, pausada: !painel.configuracao.pausada }); }, painel.configuracao.pausada ? "Central liberada conforme a configuração." : "Central pausada. Nenhum novo trabalho será iniciado.")}>{painel.configuracao.pausada ? "Retomar central" : "Pausar central"}</button>
        {painel.execucaoHabilitada ? <button className="btn" disabled={ocupado || processando || painel.configuracao.pausada || !pendentes} onClick={() => void processar()}>{processando ? "Processando tarefa…" : "Processar próxima tarefa"}</button> : null}</div>
      </div>
      {processando ? <p role="status" className="text-sm text-zinc-500">O agente está trabalhando. Você pode acompanhar, pausar a central ou cancelar o trabalho enquanto aguarda.</p> : null}
      {aba === "trabalhos" ? <><NovaTarefa catalogo={painel.catalogo} ocupado={ocupado} executar={executar} /><Execucoes execucoes={painel.execucoes} catalogo={painel.catalogo} ocupado={ocupado} executar={executar} /></> : null}
      {aba === "catalogo" ? <Catalogo painel={painel} /> : null}
      {aba === "rotinas" ? <><ConfiguracaoAgentes key={painel.configuracao.revisao} painel={painel} ocupado={ocupado} executar={executar} /><Rotinas painel={painel} ocupado={ocupado} executar={executar} /></> : null}
      {aba === "conexoes" ? <Integracoes painel={painel} /> : null}
    </> : null}
  </div>;
}
