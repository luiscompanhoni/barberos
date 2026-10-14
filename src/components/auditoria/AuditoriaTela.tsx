"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { api } from "@/lib/cliente-api";

type Item = {
  id: string; criadoEm: string; acao: string; entidade: string; entidadeId: string; quem: string; papel: string | null;
  descricao: string; mudancas: string[]; dados: unknown; ip: string | null; aparelho: string | null;
};
type Resposta = { itens: Item[]; proximo: string | null; filtros: { pessoas: { id: string; nome: string }[]; entidades: { id: string; nome: string }[] } };

const FUSO = "America/Sao_Paulo";
const hoje = () => new Date().toLocaleDateString("sv-SE", { timeZone: FUSO });
const menosDias = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
const diaTexto = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", timeZone: FUSO });
const hora = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: FUSO });
const diaDe = (iso: string) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: FUSO });

/** Auditoria: quem mudou o que, quando e de onde. O log nao se altera nem se apaga. */
export function AuditoriaTela() {
  const [f, setF] = useState(() => ({ de: menosDias(hoje(), 6), ate: hoje(), usuarioId: "", entidade: "" }));
  const [itens, setItens] = useState<Item[]>([]);
  const [proximo, setProximo] = useState<string | null>(null);
  const [filtros, setFiltros] = useState<Resposta["filtros"] | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(true);
  const ultimo = useRef(0);

  // So a resposta do ultimo pedido vale (filtro trocado rapido nao mistura listas).
  const buscar = useCallback((depois?: string) => {
    const n = ++ultimo.current;
    const q = new URLSearchParams({ de: f.de, ate: f.ate, ...(f.usuarioId ? { usuarioId: f.usuarioId } : {}), ...(f.entidade ? { entidade: f.entidade } : {}), ...(depois ? { depois } : {}) });
    api<Resposta>(`/api/auditoria?${q}`)
      .then((r) => {
        if (n !== ultimo.current) return;
        setItens((atual) => (depois ? [...atual, ...r.itens] : r.itens));
        setProximo(r.proximo);
        setFiltros(r.filtros);
        setErro("");
      })
      .catch((e: Error) => { if (n === ultimo.current) setErro(e.message); })
      .finally(() => { if (n === ultimo.current) setCarregando(false); });
  }, [f]);
  useEffect(() => buscar(), [buscar]);

  const muda = (x: Partial<typeof f>) => { setCarregando(true); setF({ ...f, ...x }); };
  const maisAntigos = () => { setCarregando(true); buscar(proximo ?? undefined); };
  return (
    <div className="space-y-4">
      <div>
        <p className="eyebrow">Segurança</p>
        <h1 className="titulo-marca text-2xl">Auditoria</h1>
        <p className="text-sm text-zinc-500">Quem mudou o quê, quando e de onde. Este registro não pode ser alterado nem apagado.</p>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div><label className="rotulo">De</label><input type="date" className="campo" value={f.de} onChange={(e) => muda({ de: e.target.value })} /></div>
        <div><label className="rotulo">Até</label><input type="date" className="campo" value={f.ate} onChange={(e) => muda({ ate: e.target.value })} /></div>
        <div className="min-w-48 flex-1"><label className="rotulo">Quem</label>
          <select className="campo" value={f.usuarioId} onChange={(e) => muda({ usuarioId: e.target.value })}>
            <option value="">Todos</option>
            {filtros?.pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </select>
        </div>
        <div className="min-w-48 flex-1"><label className="rotulo">O quê</label>
          <select className="campo" value={f.entidade} onChange={(e) => muda({ entidade: e.target.value })}>
            <option value="">Tudo</option>
            {filtros?.entidades.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
          </select>
        </div>
      </div>
      {erro && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{erro}</p>}
      {!carregando && !erro && itens.length === 0 && <div className="cartao text-sm text-zinc-500">Nada registrado nesse período.</div>}

      <div className="cartao divide-y divide-zinc-200 p-0">
        {itens.map((x, i) => (
          <div key={x.id}>
            {(i === 0 || diaDe(itens[i - 1].criadoEm) !== diaDe(x.criadoEm)) && (
              <p className="bg-zinc-100 px-4 py-1.5 text-xs font-semibold text-zinc-500 first-letter:uppercase">{diaTexto(x.criadoEm)}</p>
            )}
            <button className="flex w-full items-start gap-3 px-4 py-2.5 text-left text-sm hover:bg-zinc-50" onClick={() => setAberto(aberto === x.id ? null : x.id)}>
              <span className="w-12 shrink-0 pt-0.5 text-xs text-zinc-500">{hora(x.criadoEm)}</span>
              <span className="min-w-0 flex-1">
                <span className="font-semibold">{x.quem}</span>{x.papel && <span className="text-xs text-zinc-500"> ({x.papel})</span>} · {x.descricao}
                {x.mudancas.map((m) => <span key={m} className="block text-xs text-zinc-600">{m}</span>)}
              </span>
              {aberto === x.id ? <ChevronDown size={15} className="mt-0.5 shrink-0 text-zinc-500" /> : <ChevronRight size={15} className="mt-0.5 shrink-0 text-zinc-500" />}
            </button>
            {aberto === x.id && (
              <div className="space-y-1 px-4 pb-3 pl-[4.75rem] text-xs text-zinc-500">
                <p>Registro: {x.entidadeId} · ação “{x.acao}”</p>
                <p>De onde: {x.ip ?? "—"}{x.aparelho ? ` · ${x.aparelho}` : ""}{!x.ip && !x.aparelho ? " (rotina automática ou script)" : ""}</p>
                {x.dados !== null && <pre className="overflow-x-auto rounded-lg bg-zinc-100 p-2 text-[11px]">{JSON.stringify(x.dados, null, 2)}</pre>}
              </div>
            )}
          </div>
        ))}
      </div>
      {proximo && <button className="btn w-full" disabled={carregando} onClick={maisAntigos}>{carregando ? "Carregando…" : "Carregar mais"}</button>}
    </div>
  );
}
