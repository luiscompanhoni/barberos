"use client";

import { useCallback, useEffect, useState } from "react";
import { Megaphone, Pause, Play, Plus, Send, Square } from "lucide-react";
import { api } from "@/lib/cliente-api";
import type { Capacidade } from "@/lib/campanhas/capacidade";
import { loteSugerido, SEGMENTOS } from "@/lib/campanhas/regras";
import { CapacidadePainel } from "./CapacidadePainel";

type Seg = { chave: string; rotulo: string; total: number; podemReceber: number };
type Campanha = {
  id: string; nome: string; segmentos: string[]; mensagem: string; limiteDiario: number; taxaRespostaBps: number;
  status: "ATIVA" | "PAUSADA" | "ENCERRADA"; criadoEm: string; criadoPor: string | null;
  fila: number; enviados: number; falhas: number; pulados: number; enviadosHoje: number; marcaram: number; pararam: number; elegiveis: number;
};
type Dados = { clientes: number; aceitamMensagens: number; segmentos: Seg[]; campanhas: Campanha[]; mensagemPadrao: string };

const ROTULO = Object.fromEntries(SEGMENTOS.map((s) => [s.chave, s.rotulo]));
const STATUS = { ATIVA: "Ativa", PAUSADA: "Pausada", ENCERRADA: "Encerrada" };
const num = (n: number) => n.toLocaleString("pt-BR");

/** Campanhas no WhatsApp por segmento, liberadas em lotes do tamanho que a agenda aguenta. */
export function CampanhasTela() {
  const [d, setD] = useState<Dados | null>(null);
  const [cap, setCap] = useState<Capacidade | null>(null);
  const [nova, setNova] = useState(false);
  const [msg, setMsg] = useState<{ t: string; erro?: boolean } | null>(null);

  const carregar = useCallback(() => {
    api<Dados>("/api/campanhas").then(setD).catch((e) => setMsg({ t: e.message, erro: true }));
  }, []);
  useEffect(carregar, [carregar]);
  // Vagas dos proximos 7 dias: base para sugerir o tamanho do lote.
  const vagas7 = cap?.horizontes.find((h) => h.dias === 7)?.vagas ?? null;

  async function agir(id: string, body: object, ok: string) {
    try {
      const r = await api<{ quantidade?: number; lote?: number }>(`/api/campanhas/${id}`, { method: "PATCH", body });
      setMsg({ t: r.quantidade ? `Lote ${r.lote} liberado: ${num(r.quantidade)} cliente(s) na fila. A mensagem sai aos poucos, no horário comercial.` : ok });
      carregar();
    } catch (e) {
      setMsg({ t: (e as Error).message, erro: true });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <p className="eyebrow">Marketing</p>
          <h1 className="titulo-marca text-2xl">Campanhas</h1>
          <p className="text-sm text-zinc-500">Chame a base por grupos, no ritmo que a agenda aguenta.</p>
        </div>
        {!nova && <button className="btn-primario ml-auto" onClick={() => setNova(true)}><Plus size={16} /> Nova campanha</button>}
      </div>
      {msg && <p className={`rounded-xl p-3 text-sm ${msg.erro ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"}`}>{msg.t}</p>}

      {nova && d && <NovaCampanha dados={d} onFechar={(criou) => { setNova(false); if (criou) { setMsg({ t: "Campanha criada. Agora libere o primeiro lote." }); carregar(); } }} />}

      <CapacidadePainel onCarregar={setCap} />

      {d && (
        <section className="space-y-2">
          <h2 className="font-semibold">Segmentos da base</h2>
          <p className="text-xs text-zinc-500">{num(d.clientes)} clientes, {num(d.aceitamMensagens)} aceitam mensagens. “Podem receber” = aceitam mensagens e não têm horário marcado. Um cliente pode estar em mais de um grupo.</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {d.segmentos.map((s) => (
              <div key={s.chave} className="cartao p-3">
                <p className="text-xs text-zinc-500">{s.rotulo}</p>
                <p className="text-2xl font-black">{num(s.total)}</p>
                <p className="text-xs text-zinc-500">{num(s.podemReceber)} {s.podemReceber === 1 ? "pode" : "podem"} receber</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {d && (
        <section className="space-y-2">
          <h2 className="font-semibold">Campanhas</h2>
          {d.campanhas.length === 0 && <div className="cartao text-sm text-zinc-500">Nenhuma campanha ainda. A primeira costuma ser só para quem veio nos últimos 60 dias.</div>}
          {d.campanhas.map((c) => <CartaoCampanha key={c.id} c={c} vagas7={vagas7} onAgir={agir} />)}
        </section>
      )}
    </div>
  );
}

function CartaoCampanha({ c, vagas7, onAgir }: { c: Campanha; vagas7: number | null; onAgir: (id: string, body: object, ok: string) => void }) {
  const sugestao = vagas7 === null ? null : loteSugerido({ vagas: vagas7, taxaRespostaBps: c.taxaRespostaBps, limiteDiario: c.limiteDiario, elegiveis: c.elegiveis, naFila: c.fila });
  const [qtd, setQtd] = useState("");
  const valor = qtd === "" ? sugestao ?? 0 : Number(qtd);
  const taxa = c.enviados ? Math.round((c.marcaram / c.enviados) * 100) : null;
  return (
    <div className="cartao space-y-3">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-semibold"><Megaphone size={15} className="mr-1 inline text-ouro" />{c.nome}</p>
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
      {c.status !== "ENCERRADA" && (
        <div className="flex flex-wrap items-end gap-2">
          {c.status === "ATIVA" && (
            <>
              <div>
                <label className="rotulo">Próximo lote</label>
                <input className="campo w-28" inputMode="numeric" value={qtd === "" ? String(sugestao ?? "") : qtd} onChange={(e) => setQtd(e.target.value.replace(/\D/g, ""))} />
              </div>
              <button className="btn-primario" disabled={!(valor > 0)} onClick={() => { onAgir(c.id, { acao: "lote", quantidade: Math.min(500, valor) }, ""); setQtd(""); }}>
                <Send size={15} /> Liberar lote
              </button>
              <button className="btn" onClick={() => onAgir(c.id, { acao: "pausar" }, "Campanha pausada: a fila espera.")}><Pause size={15} /> Pausar</button>
            </>
          )}
          {c.status === "PAUSADA" && <button className="btn-primario" onClick={() => onAgir(c.id, { acao: "retomar" }, "Campanha retomada.")}><Play size={15} /> Retomar</button>}
          <button className="btn ml-auto" onClick={() => confirm(`Encerrar "${c.nome}"? Quem ainda está na fila não recebe.`) && onAgir(c.id, { acao: "encerrar" }, "Campanha encerrada.")}><Square size={14} /> Encerrar</button>
        </div>
      )}
      {c.status === "ATIVA" && (
        <p className="text-xs text-zinc-500">
          {num(c.elegiveis)} cliente(s) ainda podem ser chamados.
          {sugestao !== null && vagas7 !== null && ` Sugestão pela agenda: ${num(vagas7)} vagas nos próximos 7 dias ÷ ${c.taxaRespostaBps / 100}% de quem costuma marcar${c.fila ? `, menos ${num(c.fila)} já na fila` : ""} (até ${c.limiteDiario}/dia).`}
        </p>
      )}
    </div>
  );
}

function NovaCampanha({ dados, onFechar }: { dados: Dados; onFechar: (criou: boolean) => void }) {
  // Primeira campanha: so quem veio nos ultimos 60 dias.
  const [f, setF] = useState({ nome: "", segmentos: ["ate30", "d31a60"], mensagem: dados.mensagemPadrao, limiteDiario: "50", taxa: "20" });
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
      await api("/api/campanhas", { method: "POST", body: { nome: f.nome, segmentos: f.segmentos, mensagem: f.mensagem, limiteDiario: Number(f.limiteDiario), taxaRespostaBps: Math.round(Number(f.taxa.replace(",", ".")) * 100) } });
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
        <p className="text-xs text-zinc-500">Use {"{nome}"} (primeiro nome), {"{barbearia}"} e {"{link}"} (link para agendar). O “responda PARAR” entra sozinho no fim.</p>
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
