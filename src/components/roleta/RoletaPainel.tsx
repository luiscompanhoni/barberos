"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Check, Gift, Plus, Save, Trash2 } from "lucide-react";
import { api, centavosParaTexto, paraCentavos, reais } from "@/lib/cliente-api";
import { RodaRoleta, rotacaoAlvo } from "./RodaRoleta";

type Tipo = "CREDITO" | "BRINDE" | "NADA";
type Premio = { id?: string; chave: string; rotulo: string; tipo: Tipo; valor: string; peso: number; cor: string; ativo: boolean; limite: string; saiuNoMes?: number };
type Config = { ativa: boolean; girosPorAtendimento: number; giroGratisDias: number; bonusAssinantePct: number; validadeDias: number };
type Painel = {
  config: Config;
  premios: { id: string; rotulo: string; tipo: Tipo; valorCentavos: number; peso: number; cor: string; ativo: boolean; limiteMensal: number | null; saiuNoMes: number }[];
  aRetirar: { id: string; rotulo: string; cliente: string; telefone: string; criadoEm: string; expiraEm: string | null }[];
  ultimos: { id: string; rotulo: string; tipo: Tipo; valorCentavos: number; cliente: string; status: string; criadoEm: string }[];
  mes: { giros: number; creditoCentavos: number };
};

const CORES = ["#8BC34A", "#26A69A", "#7E57C2", "#D81B60", "#1E88E5", "#FB8C00", "#E53935", "#43A047", "#EC407A", "#00ACC1", "#FDD835", "#5E35B1"];
const TIPOS: { v: Tipo; r: string }[] = [{ v: "CREDITO", r: "Dinheiro (saldo)" }, { v: "BRINDE", r: "Brinde no balcão" }, { v: "NADA", r: "Não ganhou" }];
const quando = (d: string) => new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
let seq = 0;

/** Painel da roleta: liga/desliga, regras dos giros, premios e chances, brindes a entregar. */
export function RoletaPainel({ dono }: { dono: boolean }) {
  const [p, setP] = useState<Painel | null>(null);
  const [cfg, setCfg] = useState<Config | null>(null);
  const [premios, setPremios] = useState<Premio[]>([]);
  const [msg, setMsg] = useState<{ t: string; erro?: boolean } | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [teste, setTeste] = useState<{ rot: number; girando: boolean; i: number | null }>({ rot: 0, girando: false, i: null });

  function aplicar(d: Painel) {
    setP(d);
    setCfg(d.config);
    setPremios(d.premios.map((x) => ({
      id: x.id, chave: x.id, rotulo: x.rotulo, tipo: x.tipo, valor: x.valorCentavos ? centavosParaTexto(x.valorCentavos) : "", peso: x.peso,
      cor: x.cor, ativo: x.ativo, limite: x.limiteMensal === null ? "" : String(x.limiteMensal), saiuNoMes: x.saiuNoMes,
    })));
  }
  useEffect(() => { api<Painel>("/api/roleta").then(aplicar).catch((e) => setMsg({ t: e.message, erro: true })); }, []);

  const ativos = premios.filter((x) => x.ativo);
  const somaPesos = ativos.reduce((t, x) => t + (x.peso > 0 ? x.peso : 0), 0);
  const chance = (x: Premio) => (x.ativo && x.peso > 0 && somaPesos ? (x.peso / somaPesos) * 100 : 0);
  const fatias = useMemo(() => ativos.map((x) => ({ id: x.chave, rotulo: x.rotulo || "—", cor: x.cor })), [ativos]);

  const muda = (chave: string, d: Partial<Premio>) => setPremios((ps) => ps.map((x) => (x.chave === chave ? { ...x, ...d } : x)));
  const mover = (i: number, d: -1 | 1) => setPremios((ps) => {
    const j = i + d;
    if (j < 0 || j >= ps.length) return ps;
    const n = [...ps];
    [n[i], n[j]] = [n[j], n[i]];
    return n;
  });

  /** Sorteio de teste so na tela (mostra a chance na pratica; nao grava nada). */
  function testar() {
    const pool = ativos.filter((x) => x.peso > 0);
    if (!pool.length) return;
    let r = Math.random() * somaPesos;
    const sorteado = pool.find((x) => (r -= x.peso) < 0) ?? pool[pool.length - 1];
    const i = ativos.indexOf(sorteado);
    setTeste((t) => ({ rot: rotacaoAlvo(t.rot, i, ativos.length, Math.random() * 2 - 1), girando: true, i: null }));
    setTimeout(() => setTeste((t) => ({ ...t, i })), 0);
  }

  async function salvar() {
    if (!cfg) return;
    setMsg(null);
    for (const x of premios) {
      if (x.tipo === "CREDITO" && !(paraCentavos(x.valor) > 0)) return setMsg({ t: `"${x.rotulo}": informe o valor em reais.`, erro: true });
    }
    setSalvando(true);
    try {
      const d = await api<Painel>("/api/roleta", {
        method: "PUT",
        body: {
          config: cfg,
          premios: premios.map((x) => ({
            ...(x.id ? { id: x.id } : {}), rotulo: x.rotulo.trim(), tipo: x.tipo, valorCentavos: x.tipo === "CREDITO" ? paraCentavos(x.valor) : 0,
            peso: Math.max(0, Math.round(x.peso)), cor: x.cor, ativo: x.ativo, limiteMensal: x.limite.trim() === "" ? null : Math.max(0, Math.round(Number(x.limite))),
          })),
        },
      });
      aplicar(d);
      setMsg({ t: "Roleta salva." });
    } catch (e) {
      setMsg({ t: (e as Error).message, erro: true });
    } finally {
      setSalvando(false);
    }
  }

  async function entregar(id: string) {
    try {
      await api(`/api/roleta/giros/${id}`, { method: "POST" });
      aplicar(await api<Painel>("/api/roleta"));
    } catch (e) {
      setMsg({ t: (e as Error).message, erro: true });
    }
  }

  if (!p || !cfg) return <div className="cartao text-sm text-zinc-500">{msg?.t ?? "Carregando…"}</div>;

  const num = (k: keyof Config, v: string) => setCfg({ ...cfg, [k]: Math.max(0, Math.round(Number(v) || 0)) });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Marketing</p>
          <h1 className="titulo-marca text-2xl">Roleta de prêmios</h1>
          <p className="text-sm text-zinc-500">Este mês: {p.mes.giros} giros · {reais(p.mes.creditoCentavos)} em saldo dado</p>
        </div>
        {dono && (
          <button className="btn-primario" disabled={salvando} onClick={salvar}><Save size={16} /> {salvando ? "Salvando…" : "Salvar"}</button>
        )}
      </div>
      {msg && <p className={`rounded-xl p-3 text-sm ${msg.erro ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"}`}>{msg.t}</p>}

      {p.aRetirar.length > 0 && (
        <section className="cartao-destaque space-y-2">
          <h2 className="flex items-center gap-2 font-semibold"><Gift size={18} className="text-ouro" /> Brindes a entregar ({p.aRetirar.length})</h2>
          <ul className="divide-y divide-zinc-200">
            {p.aRetirar.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                <span className="flex-1"><b>{g.rotulo}</b> · {g.cliente} <span className="text-xs text-zinc-500">({quando(g.criadoEm)}{g.expiraEm ? `, vale até ${quando(g.expiraEm).slice(0, 5)}` : ""})</span></span>
                <button className="btn py-1 text-xs" onClick={() => entregar(g.id)}><Check size={14} /> Entregue</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {dono && (
        <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
          <div className="space-y-4">
            <section className="cartao space-y-3">
              <label className="flex items-center gap-3 font-semibold">
                <input type="checkbox" className="h-5 w-5 accent-[#d3ab45]" checked={cfg.ativa} onChange={(e) => setCfg({ ...cfg, ativa: e.target.checked })} />
                Roleta ligada na área do cliente
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <div><label className="rotulo">Giros por atendimento concluído</label><input className="campo" type="number" min={0} max={10} value={cfg.girosPorAtendimento} onChange={(e) => num("girosPorAtendimento", e.target.value)} /></div>
                <div><label className="rotulo">Giro grátis a cada (dias, 0 = não)</label><input className="campo" type="number" min={0} value={cfg.giroGratisDias} onChange={(e) => num("giroGratisDias", e.target.value)} /></div>
                <div><label className="rotulo">Bônus do assinante (%) em dinheiro</label><input className="campo" type="number" min={0} max={200} value={cfg.bonusAssinantePct} onChange={(e) => num("bonusAssinantePct", e.target.value)} /></div>
                <div><label className="rotulo">Validade do prêmio (dias)</label><input className="campo" type="number" min={1} value={cfg.validadeDias} onChange={(e) => num("validadeDias", e.target.value)} /></div>
              </div>
              <p className="text-xs text-zinc-500">Só atendimentos concluídos depois de ligar a roleta geram giros. Bônus 10% = prêmio x1.1 (aparece no selo VIP).</p>
            </section>

            <section className="cartao space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">Prêmios e chances</h2>
                <span className={`text-xs font-semibold ${ativos.length > 16 ? "text-red-600" : "text-zinc-500"}`}>{ativos.length} fatias ativas</span>
              </div>
              <div className="hidden grid-cols-[auto_1fr_auto] gap-2 px-2 text-[10px] font-bold tracking-wider text-zinc-500 uppercase sm:grid">
                <span className="w-9">Cor</span>
                <span className="grid grid-cols-[1.3fr_1.2fr_.8fr_.7fr_.8fr] gap-2"><span>Texto na roda</span><span>Tipo</span><span>Valor R$</span><span>Peso</span><span>Limite/mês</span></span>
                <span className="w-[150px] pl-4">Chance</span>
              </div>
              <div className="space-y-2">
                {premios.map((x, i) => (
                  <div key={x.chave} className={`grid grid-cols-[auto_1fr_auto] items-center gap-2 rounded-xl border p-2 ${x.ativo ? "border-zinc-200" : "border-dashed border-zinc-300 opacity-60"}`}>
                    <input type="color" value={x.cor} onChange={(e) => muda(x.chave, { cor: e.target.value })} className="h-9 w-9 cursor-pointer rounded border-0 bg-transparent" aria-label="Cor da fatia" />
                    <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-[1.3fr_1.2fr_.8fr_.7fr_.8fr]">
                      <input className="campo py-1.5" maxLength={24} placeholder="Texto na roda" value={x.rotulo} onChange={(e) => muda(x.chave, { rotulo: e.target.value })} />
                      <select className="campo py-1.5" value={x.tipo} onChange={(e) => muda(x.chave, { tipo: e.target.value as Tipo })}>
                        {TIPOS.map((t) => <option key={t.v} value={t.v}>{t.r}</option>)}
                      </select>
                      <input className="campo py-1.5" placeholder={x.tipo === "CREDITO" ? "R$" : "—"} disabled={x.tipo !== "CREDITO"} inputMode="decimal" value={x.tipo === "CREDITO" ? x.valor : ""} onChange={(e) => muda(x.chave, { valor: e.target.value })} title="Valor do crédito" />
                      <input className="campo py-1.5" type="number" min={0} value={x.peso} onChange={(e) => muda(x.chave, { peso: Number(e.target.value) || 0 })} title="Peso no sorteio" />
                      <input className="campo py-1.5" type="number" min={0} placeholder="sem limite" value={x.limite} onChange={(e) => muda(x.chave, { limite: e.target.value })} title="Máximo por mês" />
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="w-14 text-right text-sm font-bold text-ouro">{chance(x).toFixed(1)}%</span>
                      <button className="rounded p-1 text-zinc-500 hover:bg-zinc-100" onClick={() => mover(i, -1)} aria-label="Subir"><ArrowUp size={14} /></button>
                      <button className="rounded p-1 text-zinc-500 hover:bg-zinc-100" onClick={() => mover(i, 1)} aria-label="Descer"><ArrowDown size={14} /></button>
                      <input type="checkbox" className="h-4 w-4 accent-[#d3ab45]" checked={x.ativo} onChange={(e) => muda(x.chave, { ativo: e.target.checked })} title="Ativo" />
                      <button className="rounded p-1 text-zinc-500 hover:bg-red-50 hover:text-red-600" onClick={() => setPremios((ps) => ps.filter((y) => y.chave !== x.chave))} aria-label="Remover"><Trash2 size={14} /></button>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-zinc-500">Colunas: texto · tipo · valor · <b>peso</b> (a chance é o peso dividido pela soma dos pesos ativos) · limite por mês (ex.: corte grátis no máximo 2 por mês).</p>
              <button className="btn" onClick={() => setPremios((ps) => [...ps, { chave: `novo${++seq}`, rotulo: "", tipo: "CREDITO", valor: "", peso: 10, cor: CORES[ps.length % CORES.length], ativo: true, limite: "" }])}>
                <Plus size={15} /> Adicionar prêmio
              </button>
            </section>
          </div>

          <aside className="space-y-3">
            <section className="roleta-moldura rounded-2xl p-4">
              <p className="roleta-titulo mb-2 text-xl">Prévia</p>
              <RodaRoleta fatias={fatias} rotacao={teste.rot} girando={teste.girando} destaque={teste.girando ? null : teste.i}
                onGirar={testar} podeGirar={fatias.length > 1} rotuloBotao="TESTAR" aoParar={() => setTeste((t) => ({ ...t, girando: false }))} />
              <p className="mt-3 text-center text-xs text-[#cbd5e1]">Toque em TESTAR para simular um sorteio com as chances acima (não grava nada).</p>
            </section>
          </aside>
        </div>
      )}

      <section className="cartao">
        <h2 className="mb-2 font-semibold">Últimos giros</h2>
        {p.ultimos.length === 0 ? <p className="text-sm text-zinc-500">Ninguém girou ainda.</p> : (
          <ul className="divide-y divide-zinc-200 text-sm">
            {p.ultimos.map((g) => (
              <li key={g.id} className="flex items-center gap-3 py-1.5">
                <span className="w-24 text-xs text-zinc-500">{quando(g.criadoEm)}</span>
                <span className="flex-1">{g.cliente}</span>
                <span className="font-semibold">{g.tipo === "CREDITO" ? reais(g.valorCentavos) : g.rotulo}</span>
                {g.tipo === "BRINDE" && <span className="text-xs text-zinc-500">{g.status === "A_RETIRAR" ? "a retirar" : g.status === "EXPIRADO" ? "venceu" : "entregue"}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
