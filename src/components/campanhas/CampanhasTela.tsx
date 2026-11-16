"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Megaphone, Plus } from "lucide-react";
import { api } from "@/lib/cliente-api";
import type { Capacidade } from "@/lib/campanhas/capacidade";
import { loteSugerido, SEGMENTOS } from "@/lib/campanhas/regras";
import { MODELOS_SEGMENTOS } from "@/lib/campanhas/modelos-segmento";
import { CapacidadePainel } from "./CapacidadePainel";
import { FunilCampanha } from "./FunilCampanha";
import { ContadorCrm } from "@/components/visual/ContadorCrm";
import { CampanhaDetalhe, type Campanha, type JogosCampanha, type SegmentoCampanha } from "./CampanhaDetalhe";

type Dados = {
  clientes: number; aceitamMensagens: number; segmentos: SegmentoCampanha[]; campanhas: Campanha[];
  enviosBloqueados: boolean; mensagemPadrao: string; mensagemPadraoRoleta: string; jogos: JogosCampanha;
};

const ROTULO = Object.fromEntries(SEGMENTOS.map((s) => [s.chave, s.rotulo]));
const STATUS = { ATIVA: "Ativa", PAUSADA: "Pausada", ENCERRADA: "Encerrada" };
const num = (n: number) => n.toLocaleString("pt-BR");

/** Campanhas no WhatsApp por segmento, liberadas em lotes do tamanho que a agenda aguenta. */
export function CampanhasTela() {
  const [d, setD] = useState<Dados | null>(null);
  const [cap, setCap] = useState<Capacidade | null>(null);
  const [nova, setNova] = useState(false);
  const [msg, setMsg] = useState<{ t: string; erro?: boolean } | null>(null);
  const [detalheId, setDetalheId] = useState<string | null>(null);
  const [preparando, setPreparando] = useState(false);

  const carregar = useCallback(() => api<Dados>("/api/campanhas").then(setD), []);
  useEffect(() => {
    void carregar().catch(e => setMsg({ t: e.message, erro: true }));
  }, [carregar]);
  // Vagas dos proximos 7 dias: base para sugerir o tamanho do lote.
  const vagas7 = cap?.horizontes.find((h) => h.dias === 7)?.vagas ?? null;
  const modelo = MODELOS_SEGMENTOS.find(m => m.id === detalheId);
  const campanha = d?.campanhas.find(c => c.id === detalheId);
  const faltam = d && MODELOS_SEGMENTOS.some(m => !d.campanhas.some(c => c.id === m.id));

  async function preparar() {
    setPreparando(true); setMsg(null);
    try {
      const { criadas } = await api<{ criadas: number }>("/api/campanhas", { method: "POST", body: { acao: "preparar_segmentos" } });
      await carregar();
      setMsg({ t: criadas ? `${num(criadas)} campanha(s) preparada(s) e pausada(s).` : "Os rascunhos dos segmentos já estão preparados." });
    } catch (e) {
      setMsg({ t: (e as Error).message, erro: true });
    } finally {
      setPreparando(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="crm-page-header flex flex-wrap items-end gap-2">
        <div>
          <p className="eyebrow">Marketing</p>
          <h1 className="titulo-marca text-2xl">Campanhas</h1>
          <p className="text-sm text-zinc-500">Chame a base por grupos, no ritmo que a agenda aguenta.</p>
          <div className="mt-2 flex flex-wrap gap-3 text-sm"><a className="text-ouro underline" href="/migracao-assinaturas">Migração de assinaturas</a><a className="text-ouro underline" href="/crescimento">Metas, margem e orçamento</a><a className="text-ouro underline" href="/calendario-conteudo">Calendário de conteúdo</a></div>
        </div>
        {!nova && <button className="btn-primario ml-auto" onClick={() => setNova(true)}><Plus size={16} /> Nova campanha</button>}
      </div>
      {msg && <p role={msg.erro ? "alert" : "status"} className={`rounded-xl p-3 text-sm ${msg.erro ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"}`}>{msg.t}</p>}

      {nova && d && <NovaCampanha dados={d} onFechar={(criou) => {
        setNova(false);
        if (criou) {
          setMsg({ t: "Campanha criada. Abra o card para revisar a configuração." });
          void carregar().catch(e => setMsg({ t: e.message, erro: true }));
        }
      }} />}

      <CapacidadePainel onCarregar={setCap} />

      {d && (
        <section className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">Segmentos da base</h2>
            {faltam && <button type="button" className="btn" disabled={preparando} onClick={() => void preparar()}>
              {preparando ? "Preparando…" : `Preparar ${MODELOS_SEGMENTOS.length} rascunhos`}
            </button>}
          </div>
          {d.enviosBloqueados && <p role="status" className="text-xs text-zinc-500">Envios de campanhas bloqueados. Os rascunhos podem ser revisados e editados.</p>}
          <p className="text-xs text-zinc-500">{num(d.clientes)} clientes, {num(d.aceitamMensagens)} aceitam mensagens. Um cliente pode estar em mais de um grupo.</p>
          <div className="crm-collection grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {d.segmentos.map((s) => {
              const modelo = MODELOS_SEGMENTOS.find(m => m.chave === s.chave);
              if (!modelo) return null;
              const c = d.campanhas.find(c => c.id === modelo.id);
              return <button type="button" key={s.chave} className="cartao cartao-clicavel crm-kpi p-3 text-left"
                onClick={() => setDetalheId(modelo.id)} aria-label={`Abrir campanha: ${s.rotulo}`} aria-haspopup="dialog">
                <p className="text-xs text-zinc-500">{s.rotulo}</p>
                <p className="text-2xl font-normal"><ContadorCrm valor={s.total} formatar={num} /></p>
                <p className="text-xs text-zinc-500">{num(s.podemReceber)} {s.podemReceber === 1 ? "pode" : "podem"} receber</p>
                <span className="mt-1 inline-flex items-center gap-1 text-xs font-semibold">{c ? STATUS[c.status] : "Ver rascunho"} <ChevronRight size={13} aria-hidden="true" /></span>
              </button>;
            })}
          </div>
        </section>
      )}

      {d && (
        <section className="space-y-2">
          <h2 className="font-semibold">Campanhas</h2>
          {d.campanhas.length === 0 && <div className="cartao text-sm text-zinc-500">Nenhuma campanha ainda. A primeira costuma ser só para quem veio nos últimos 60 dias.</div>}
          {d.campanhas.map((c) => <CartaoCampanha key={c.id} c={c} vagas7={vagas7} onAbrir={() => setDetalheId(c.id)} />)}
        </section>
      )}
      {d && detalheId && (campanha || modelo) && <CampanhaDetalhe key={detalheId} campanha={campanha} modelo={modelo}
        segmentos={d.segmentos} jogos={d.jogos} enviosBloqueados={d.enviosBloqueados} onAlterar={carregar}
        onFechar={() => setDetalheId(null)} />}
    </div>
  );
}

function CartaoCampanha({ c, vagas7, onAbrir }: { c: Campanha; vagas7: number | null; onAbrir: () => void }) {
  const sugestao = vagas7 === null ? null : loteSugerido({ vagas: vagas7, taxaRespostaBps: c.taxaRespostaBps, limiteDiario: c.limiteDiario, elegiveis: c.elegiveis, naFila: c.fila });
  const [funil, setFunil] = useState(false);
  const taxa = c.enviados ? Math.round((c.marcaram / c.enviados) * 100) : null;
  return (
    <div className="cartao space-y-3">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <button type="button" className="font-semibold underline" onClick={onAbrir} aria-haspopup="dialog" aria-label={`Gerenciar campanha ${c.nome}`}>
            <Megaphone size={15} className="mr-1 inline text-ouro" />{c.nome}
          </button>
          {c.jogo && <span className="ml-2 rounded-full bg-ouro/15 px-2 py-0.5 text-[11px] font-semibold text-ouro">{c.jogo.nome}</span>}
          <p className="text-xs text-zinc-500">{c.segmentos.map((s) => ROTULO[s] ?? s).join(" + ")} · até {c.limiteDiario}/dia{c.criadoPor ? ` · criada por ${c.criadoPor}` : ""}</p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${c.status === "ATIVA" ? "bg-emerald-50 text-emerald-800" : c.status === "PAUSADA" ? "bg-amber-50 text-amber-800" : "bg-zinc-100 text-zinc-500"}`}>{STATUS[c.status]}</span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center text-sm sm:grid-cols-6">
        {[
          ["Na fila", c.fila], ["Hoje", `${c.enviadosHoje}/${c.limiteDiario}`], ["Enviados", c.enviados],
          ["Marcaram", `${c.marcaram}${taxa === null ? "" : ` (${taxa}%)`}`], ["Pararam", c.pararam], ["Falhas", c.falhas],
        ].map(([r, v]) => (
          <div key={r as string} className="rounded-lg bg-zinc-100 px-2 py-1.5">
            <p className="text-[11px] text-zinc-500">{r}</p>
            <p className="font-bold">{v}</p>
          </div>
        ))}
      </div>
      {(c.enviados > 0 || c.fila > 0) && (
        <div className="border-t border-zinc-200 pt-2">
          <button className="flex items-center gap-1 text-sm font-semibold" aria-expanded={funil} onClick={() => setFunil(!funil)}>
            {funil ? <ChevronDown size={15} /> : <ChevronRight size={15} />} Funil da campanha
          </button>
          {funil && <div className="mt-2"><FunilCampanha id={c.id} /></div>}
        </div>
      )}
      {c.status === "ATIVA" && (
        <p className="text-xs text-zinc-500">
          {num(c.elegiveis)} cliente(s) ainda podem ser chamados.
          {sugestao !== null && vagas7 !== null && ` Sugestão para o lote: ${num(sugestao)} contato(s), considerando ${num(vagas7)} vagas nos próximos 7 dias, a estimativa de agendamento e o limite diário.`}
        </p>
      )}
    </div>
  );
}

function NovaCampanha({ dados, onFechar }: { dados: Dados; onFechar: (criou: boolean) => void }) {
  // Primeira campanha: so quem veio nos ultimos 60 dias.
  const [f, setF] = useState({ nome: "", segmentos: ["ate30", "d31a60"], mensagem: dados.mensagemPadrao, limiteDiario: "50", taxa: "20", jogoId: "" });
  const [elegiveis, setElegiveis] = useState<number | null>(null);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const chave = f.segmentos.join(",");
  useEffect(() => {
    if (!chave) return;
    const t = setTimeout(() => api<{ elegiveis: number }>(`/api/campanhas/previa?segmentos=${chave}`).then((r) => setElegiveis(r.elegiveis)).catch(() => setElegiveis(null)), 250);
    return () => clearTimeout(t);
  }, [chave]);

  const marcar = (s: string, v: boolean) => setF({ ...f, segmentos: v ? [...f.segmentos, s] : f.segmentos.filter((x) => x !== s) });
  async function criar(e: React.FormEvent) {
    e.preventDefault();
    setOcupado(true);
    try {
      await api("/api/campanhas", { method: "POST", body: { nome: f.nome, segmentos: f.segmentos, mensagem: f.mensagem, limiteDiario: Number(f.limiteDiario), taxaRespostaBps: Math.round(Number(f.taxa.replace(",", ".")) * 100), jogoId: f.jogoId || null } });
      onFechar(true);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <form onSubmit={criar} className="cartao space-y-3">
      <h2 className="font-semibold">Nova campanha</h2>
      <div><label className="rotulo">Nome</label><input className="campo" placeholder="Ex.: Lançamento do app — base recente" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} /></div>
      <div>
        <label className="rotulo">Presente no link</label>
        <select className="campo" value={f.jogoId}
          onChange={(e) => setF({ ...f, jogoId: e.target.value, mensagem: e.target.value ? dados.mensagemPadraoRoleta : dados.mensagemPadrao })}>
          <option value="">Sem jogo: o link abre a agenda</option>
          {dados.jogos.map((j) => <option key={j.id} value={j.id}>1 jogada na {j.nome}</option>)}
        </select>
        <p className="mt-1 text-xs text-zinc-500">Com jogo, o link abre o jogo com 1 jogada de presente, sem precisar entrar no app. O funil mostra quem abriu, jogou, ganhou, criou conta, agendou, veio e resgatou.{!dados.jogos.length && " Ligue um jogo na tela Jogos para poder escolher."}</p>
      </div>
      <div>
        <label className="rotulo">Quem recebe (soma dos grupos marcados)</label>
        <div className="grid gap-1 sm:grid-cols-2">
          {dados.segmentos.map((s) => (
            <label key={s.chave} className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-[#d3ab45]" checked={f.segmentos.includes(s.chave)} onChange={(e) => marcar(s.chave, e.target.checked)} />
              {s.rotulo} <span className="text-xs text-zinc-500">({num(s.podemReceber)})</span>
            </label>
          ))}
        </div>
        <p className="mt-1 text-xs text-zinc-500">{!chave ? "Marque pelo menos um grupo." : elegiveis === null ? "Contando…" : `${num(elegiveis)} ${elegiveis === 1 ? "cliente pode" : "clientes podem"} receber agora.`}</p>
      </div>
      <div>
        <label className="rotulo">Mensagem</label>
        <textarea className="campo min-h-28" value={f.mensagem} onChange={(e) => setF({ ...f, mensagem: e.target.value })} />
        <p className="text-xs text-zinc-500">Use {"{nome}"} (primeiro nome), {"{barbearia}"} e {"{link}"} ({f.jogoId ? "abre o jogo" : "abre a agenda"}; cada cliente recebe o seu, para o funil saber quem clicou). O “responda PARAR” entra sozinho no fim.</p>
      </div>
      <div className="flex flex-wrap gap-3">
        <div><label className="rotulo">Limite por dia</label><input className="campo w-28" inputMode="numeric" value={f.limiteDiario} onChange={(e) => setF({ ...f, limiteDiario: e.target.value.replace(/\D/g, "") })} /></div>
        <div><label className="rotulo">Quantos costumam marcar (%)</label><input className="campo w-28" inputMode="decimal" value={f.taxa} onChange={(e) => setF({ ...f, taxa: e.target.value })} /></div>
      </div>
      <p className="text-xs text-zinc-500">O limite por dia segura o envio mesmo que o lote seja maior. A porcentagem serve para sugerir o tamanho do lote pela agenda livre (com 20%, cada 10 vagas pedem 50 mensagens).</p>
      {erro && <p className="text-sm text-red-600">{erro}</p>}
      <div className="flex gap-2">
        <button className="btn-primario" disabled={ocupado || !f.segmentos.length}>{ocupado ? "Criando…" : "Criar campanha"}</button>
        <button type="button" className="btn" onClick={() => onFechar(false)}>Cancelar</button>
      </div>
    </form>
  );
}
