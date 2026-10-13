"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { horariosLivres } from "@/lib/agenda/disponibilidade";
import { dataLocal, instanteLocal, minParaHhmm, minutosLocal } from "@/lib/agenda/tempo";
import { FotoBarbeiro } from "@/components/FotoBarbeiro";
import { ROTULO_ORIGEM, ROTULO_STATUS, type AgendamentoApi, type Coluna, type Status } from "./tipos";

const PX_MIN = 1.6; // 15 min = 24 px
const LIMIAR_ARRASTO = 5;

type Arrasto = {
  ag: AgendamentoApi;
  modo: "mover" | "esticar";
  y0: number;
  x0: number;
  colunaOrig: string;
  inicioOrig: number; // minutos locais
  durOrig: number;
  moveu: boolean;
};
type Previa = { agId: string; coluna: string; inicioMin: number; durMin: number };

const ESTILO_STATUS: Partial<Record<Status, string>> = {
  CHEGOU: "ring-2 ring-amber-400",
  EM_ATENDIMENTO: "ring-2 ring-emerald-500",
  CONCLUIDO: "opacity-55",
  FALTOU: "opacity-50 line-through",
};

export function Grade(props: {
  colunas: Coluna[];
  agendamentos: AgendamentoApi[];
  fuso: string;
  granularidadeMin: number;
  podeEditar: (barbeiroId: string) => boolean;
  onMover: (ag: AgendamentoApi, coluna: Coluna, inicio: number, fim: number) => Promise<void>;
  onVazio: (coluna: Coluna, inicio: number) => void;
  onAbrir: (ag: AgendamentoApi) => void;
}) {
  const { colunas, agendamentos, fuso, granularidadeMin: gran } = props;
  const refsColunas = useRef(new Map<string, HTMLDivElement>());
  const arrasto = useRef<Arrasto | null>(null);
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [agora, setAgora] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const minLocal = (iso: string | number) => minutosLocal(typeof iso === "number" ? iso : Date.parse(iso), fuso);
  const colunaDeAg = (ag: AgendamentoApi) => `${ag.barbeiroId}|${dataLocal(Date.parse(ag.inicio), fuso)}`;

  // Faixa vertical: do primeiro expediente/atendimento ao ultimo, com folga.
  const [iniDia, fimDia] = useMemo(() => {
    let ini = 9 * 60;
    let fim = 19 * 60;
    for (const c of colunas) for (const j of c.janelas) {
      ini = Math.min(ini, minLocal(j.inicio));
      fim = Math.max(fim, minLocal(j.fim) || 1440);
    }
    for (const a of agendamentos) {
      ini = Math.min(ini, minLocal(a.inicio));
      fim = Math.max(fim, minLocal(a.fim) || 1440);
    }
    return [Math.max(0, Math.floor(ini / 60) * 60 - 30), Math.min(1440, Math.ceil(fim / 60) * 60 + 30)];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colunas, agendamentos, fuso]);
  const altura = (fimDia - iniDia) * PX_MIN;
  const y = (min: number) => (min - iniDia) * PX_MIN;

  function livres(c: Coluna) {
    const ags = agendamentos
      .filter((a) => colunaDeAg(a) === c.chave && a.status !== "FALTOU")
      .map((a) => ({ inicio: Date.parse(a.inicio), fim: Date.parse(a.fim) }));
    return horariosLivres({
      janelas: c.janelas.map((j) => ({ inicio: Date.parse(j.inicio), fim: Date.parse(j.fim) })),
      bloqueios: c.bloqueios.map((b) => ({ inicio: Date.parse(b.inicio), fim: Date.parse(b.fim) })),
      agendamentos: ags,
      duracaoMin: 30,
      granularidadeMin: 30,
      intervaloEntreClientesMin: 0,
      naoAntesDe: agora,
    }).length;
  }

  function colunaSobPonteiro(x: number): string | null {
    for (const [chave, el] of refsColunas.current) {
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right) return chave;
    }
    return null;
  }

  function iniciarArrasto(e: React.PointerEvent, ag: AgendamentoApi, modo: Arrasto["modo"]) {
    e.stopPropagation();
    if (!props.podeEditar(ag.barbeiroId) || ag.status === "CONCLUIDO") {
      props.onAbrir(ag);
      return;
    }
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const inicio = minLocal(ag.inicio);
    arrasto.current = {
      ag, modo, y0: e.clientY, x0: e.clientX, colunaOrig: colunaDeAg(ag),
      inicioOrig: inicio, durOrig: minLocal(ag.fim) - inicio || 1440 - inicio, moveu: false,
    };
  }

  function mover(e: React.PointerEvent) {
    const a = arrasto.current;
    if (!a) return;
    if (!a.moveu && Math.abs(e.clientY - a.y0) + Math.abs(e.clientX - a.x0) < LIMIAR_ARRASTO) return;
    a.moveu = true;
    const delta = Math.round((e.clientY - a.y0) / PX_MIN / gran) * gran;
    if (a.modo === "esticar") {
      setPrevia({ agId: a.ag.id, coluna: a.colunaOrig, inicioMin: a.inicioOrig, durMin: Math.max(gran, a.durOrig + delta) });
    } else {
      const col = colunaSobPonteiro(e.clientX) ?? a.colunaOrig;
      const ini = Math.min(Math.max(iniDia, a.inicioOrig + delta), fimDia - a.durOrig);
      setPrevia({ agId: a.ag.id, coluna: col, inicioMin: ini, durMin: a.durOrig });
    }
  }

  async function soltar() {
    const a = arrasto.current;
    arrasto.current = null;
    if (!a) return;
    if (!a.moveu) {
      setPrevia(null);
      props.onAbrir(a.ag);
      return;
    }
    const p = previa;
    if (!p || (p.coluna === a.colunaOrig && p.inicioMin === a.inicioOrig && p.durMin === a.durOrig)) {
      setPrevia(null);
      return;
    }
    const col = colunas.find((c) => c.chave === p.coluna)!;
    const inicio = instanteLocal(col.data, p.inicioMin, fuso);
    try {
      await props.onMover(a.ag, col, inicio, inicio + p.durMin * 60_000);
    } finally {
      setPrevia(null);
    }
  }

  function clicarVazio(e: React.MouseEvent, c: Coluna) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const min = Math.floor((iniDia + (e.clientY - r.top) / PX_MIN) / gran) * gran;
    props.onVazio(c, instanteLocal(c.data, min, fuso));
  }

  const horas: number[] = [];
  for (let m = Math.ceil(iniDia / 60) * 60; m < fimDia; m += 60) horas.push(m);
  const hoje = dataLocal(agora, fuso);

  return (
    <div className="max-h-[calc(100vh-150px)] overflow-auto rounded-xl border border-zinc-200 bg-white" onPointerMove={mover} onPointerUp={soltar} onPointerCancel={() => { arrasto.current = null; setPrevia(null); }}>
      <div className="grid select-none" style={{ gridTemplateColumns: `52px repeat(${colunas.length}, minmax(150px, 1fr))`, minWidth: 52 + colunas.length * 150 }}>
        <div className="sticky left-0 top-0 z-30 border-b border-zinc-200 bg-white" />
        {colunas.map((c) => (
          <div key={c.chave} className="sticky top-0 z-20 border-b border-l border-zinc-200 bg-white px-2 py-2">
            <div className="flex items-center gap-2">
              <FotoBarbeiro id={c.barbeiroId} nome={c.barbeiroNome} cor={c.cor} versao={c.fotoVersao} tamanho={30} />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold capitalize">
                  {c.titulo} {c.subtitulo && <span className="font-normal text-zinc-500">{c.subtitulo}</span>}
                </div>
                <div className="text-xs text-emerald-700">
                  {c.janelas.length === 0 ? <span className="text-zinc-400">Não trabalha</span> : `${livres(c)} horários livres`}
                </div>
              </div>
            </div>
          </div>
        ))}

        <div className="sticky left-0 z-20 bg-white" style={{ height: altura }}>
          {horas.map((m) => (
            <div key={m} className="absolute right-2 -translate-y-2 text-[11px] text-zinc-500" style={{ top: y(m) }}>{minParaHhmm(m)}</div>
          ))}
        </div>

        {colunas.map((c) => {
          const editavel = props.podeEditar(c.barbeiroId);
          return (
            <div key={c.chave} ref={(el) => { if (el) refsColunas.current.set(c.chave, el); else refsColunas.current.delete(c.chave); }}
              className={`relative border-l border-zinc-200 bg-zinc-100 ${editavel ? "cursor-cell" : ""}`}
              style={{ height: altura }} onClick={(e) => editavel && clicarVazio(e, c)}>
              {c.janelas.map((j) => (
                <div key={j.inicio} className="absolute inset-x-0 bg-white" style={{ top: y(minLocal(j.inicio)), height: ((minLocal(j.fim) || 1440) - minLocal(j.inicio)) * PX_MIN }} />
              ))}
              {horas.map((m) => (
                <div key={m} className="pointer-events-none absolute inset-x-0 border-t border-zinc-200" style={{ top: y(m) }} />
              ))}
              {horas.map((m) => (
                <div key={`m${m}`} className="pointer-events-none absolute inset-x-0 border-t border-dashed border-zinc-100" style={{ top: y(m + 30) }} />
              ))}
              {c.bloqueios.map((b) => {
                const ini = dataLocal(Date.parse(b.inicio), fuso) < c.data ? iniDia : minLocal(b.inicio);
                const fim = dataLocal(Date.parse(b.fim) - 1, fuso) > c.data ? fimDia : minLocal(b.fim) || 1440;
                return (
                  <div key={b.id} className="absolute inset-x-1 rounded-md border border-dashed border-zinc-400 px-2 py-1 text-xs text-zinc-600"
                    style={{ top: y(Math.max(ini, iniDia)), height: (Math.min(fim, fimDia) - Math.max(ini, iniDia)) * PX_MIN,
                      background: "repeating-linear-gradient(135deg,#141312,#141312 6px,#1c1b19 6px,#1c1b19 12px)" }}
                    onClick={(e) => e.stopPropagation()}>
                    Agenda fechada{b.motivo ? ` · ${b.motivo}` : ""}
                  </div>
                );
              })}
              {c.data === hoje && minLocal(agora) > iniDia && minLocal(agora) < fimDia && (
                <div className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-red-500" style={{ top: y(minLocal(agora)) }} />
              )}
              {agendamentos.filter((a) => colunaDeAg(a) === c.chave && previa?.agId !== a.id).map((a) => (
                <Cartao key={a.id} ag={a} cor={c.cor} topo={y(minLocal(a.inicio))}
                  alturaPx={((minLocal(a.fim) || 1440) - minLocal(a.inicio)) * PX_MIN}
                  horario={`${minParaHhmm(minLocal(a.inicio))}-${minParaHhmm(minLocal(a.fim))}`}
                  onPointerDown={(e, modo) => iniciarArrasto(e, a, modo)} />
              ))}
              {previa && previa.coluna === c.chave && (() => {
                const a = agendamentos.find((x) => x.id === previa.agId)!;
                return (
                  <Cartao ag={a} cor={c.cor} topo={y(previa.inicioMin)} alturaPx={previa.durMin * PX_MIN} fantasma
                    horario={`${minParaHhmm(previa.inicioMin)}-${minParaHhmm(previa.inicioMin + previa.durMin)}`} />
                );
              })()}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Cartao(p: {
  ag: AgendamentoApi;
  cor: string;
  topo: number;
  alturaPx: number;
  horario: string;
  fantasma?: boolean;
  onPointerDown?: (e: React.PointerEvent, modo: "mover" | "esticar") => void;
}) {
  const { ag } = p;
  return (
    <div
      className={`absolute inset-x-1 z-10 overflow-hidden rounded-md border-l-4 px-2 py-1 text-xs leading-tight shadow-sm touch-none ${
        p.fantasma ? "opacity-80 ring-2 ring-zinc-900" : "cursor-grab active:cursor-grabbing"
      } ${ESTILO_STATUS[ag.status] ?? ""}`}
      style={{ top: p.topo + 1, height: Math.max(p.alturaPx - 2, 18), borderLeftColor: p.cor, background: `${p.cor}1f` }}
      onPointerDown={(e) => p.onPointerDown?.(e, "mover")}
      onClick={(e) => e.stopPropagation()}
      title={`${ag.cliente.nome} · ${ag.servico.nome} · ${ROTULO_STATUS[ag.status]}`}
    >
      <div className="flex items-center gap-1 font-semibold text-zinc-900">
        <span className="truncate">{ag.cliente.nome}</span>
        {ag.assinante && <span className="rounded bg-violet-100 px-1 text-[10px] text-violet-800">Assinante</span>}
        {ag.semPreferencia && <span title="Sem preferência de barbeiro: pode trocar" className="rounded bg-sky-100 px-1 text-[10px] text-sky-800">S/P</span>}
      </div>
      <div className="truncate text-zinc-700">{p.horario} · {ag.servico.nome}</div>
      {p.alturaPx > 56 && (
        <div className="truncate text-[11px] text-zinc-500">
          {ROTULO_STATUS[ag.status]} · {ROTULO_ORIGEM[ag.origem] ?? ag.origem}
        </div>
      )}
      {p.onPointerDown && (
        <div className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize" onPointerDown={(e) => p.onPointerDown?.(e, "esticar")} />
      )}
    </div>
  );
}
