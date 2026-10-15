"use client";

/**
 * Resultado do mes (conciliacao): o faturamento registrado no BarberOS ao lado do que caiu na Celcash
 * (mensalidades) e na Stone (maquininha e Pix), as taxas, as saidas e o lucro, com as divergencias marcadas.
 * As saidas sao classificadas aqui (e viram regra por nome com "lembrar").
 */
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, RefreshCw, Trash2, Upload } from "lucide-react";
import { api, reais } from "@/lib/cliente-api";
import { CATEGORIAS_DESPESA, ROTULO_CATEGORIA } from "@/lib/financeiro/regras";
import { mesAtual } from "./DespesasTela";

type Extrato = {
  recebido: number; recebidoPorForma: Record<string, number>; taxas: number; antecipacao: number; tarifas: number; estornos: number; custoGateway: number;
  liquido: number; transferidoParaEmpresa: number; voltouDaEmpresa: number; pagamentos: number; despesa: number; retiradas: number; semCategoria: number;
};
type Resultado = {
  mes: string; sincronizadoAte: Record<string, string | null>;
  registrado: { total: number; porForma: Record<string, number>; mensalidades: number; antecipados: number; links: number; estornos: number };
  celcash: Extrato; stone: Extrato;
  custos: { celcash: number; stone: number; maquininhaEstimada: number; total: number };
  despesas: { barberos: number; celcash: number; stone: number; total: number; porCategoria: Record<string, number> };
  retiradas: number; lucro: number; divergencias: { mensalidades: number; cartao: number; pix: number }; alertas: string[];
};
type Movimento = { id: string; fonte: string; data: string; valorCentavos: number; tipo: string; descricao: string; categoria: string | null; observacao: string | null; classificadoPorId: string | null };
type Regra = { id: string; padrao: string; tipo: string; categoria: string | null };

const FORMA: Record<string, string> = { DINHEIRO: "Dinheiro", PIX: "Pix", DEBITO: "Débito", CREDITO: "Crédito", CARTAO: "Cartão", BOLETO: "Boleto" };
const CATEGORIAS_SAIDA = [...CATEGORIAS_DESPESA, "RETIRADA_SOCIO", "JA_LANCADA"];
const ROTULO_SAIDA: Record<string, string> = { ...ROTULO_CATEGORIA, RETIRADA_SOCIO: "Retirada do sócio", JA_LANCADA: "Já lançada em Despesas" };
const quando = (d: string) => new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

function Linha({ r, v, forte, neg, cor }: { r: string; v: number; forte?: boolean; neg?: boolean; cor?: string }) {
  return (
    <div className={`flex justify-between gap-3 py-1 text-sm ${forte ? "font-bold" : ""}`}>
      <span className="text-zinc-600">{r}</span>
      <span className={cor}>{neg && v ? "− " : ""}{reais(Math.abs(v))}</span>
    </div>
  );
}
function Dif({ r, v }: { r: string; v: number }) {
  return <div className={`mt-1 rounded-lg p-2 text-xs ${Math.abs(v) > 100 ? "bg-amber-50 text-amber-900" : "bg-emerald-50 text-emerald-800"}`}>{r}: <b>{reais(v)}</b></div>;
}

export function ResultadoTela() {
  const [mes, setMes] = useState(mesAtual);
  const [r, setR] = useState<Resultado | null>(null);
  const [saidas, setSaidas] = useState<Movimento[]>([]);
  const [regras, setRegras] = useState<Regra[]>([]);
  const [msg, setMsg] = useState<{ t: string; erro?: boolean } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [lembrar, setLembrar] = useState(true);
  const [filtro, setFiltro] = useState<"sem" | "todas">("sem");

  const carregar = useCallback(() => {
    api<Resultado>(`/api/financeiro/resultado?mes=${mes}`).then(setR).catch((e) => setMsg({ t: e.message, erro: true }));
    Promise.all([api<Movimento[]>(`/api/financeiro/externos?mes=${mes}&tipo=PAGAMENTO`), api<Movimento[]>(`/api/financeiro/externos?mes=${mes}&tipo=TRANSFERENCIA`)])
      .then(([p, t]) => setSaidas([...p, ...t.filter((x) => x.valorCentavos < 0)].sort((a, b) => a.valorCentavos - b.valorCentavos))).catch(() => {});
    api<Regra[]>("/api/financeiro/regras").then(setRegras).catch(() => {});
  }, [mes]);
  useEffect(() => { carregar(); }, [carregar]);

  async function sincronizar(historico: boolean) {
    setOcupado(true); setMsg(null);
    try {
      const x = await api<{ novos: number }>("/api/financeiro/externos/sincronizar", { method: "POST", body: { historico } });
      setMsg({ t: x.novos ? `${x.novos} movimentos novos da Celcash.` : "Celcash já estava em dia." });
      carregar();
    } catch (e) { setMsg({ t: (e as Error).message, erro: true }); } finally { setOcupado(false); }
  }
  async function subirStone(f: File | undefined) {
    if (!f) return;
    setOcupado(true); setMsg(null);
    try {
      const resp = await fetch("/api/financeiro/externos/stone", { method: "POST", headers: { "content-type": "text/csv" }, body: await f.text() });
      const j = await resp.json();
      if (!resp.ok) throw new Error(j.erro ?? "Não consegui ler o arquivo.");
      setMsg({ t: `Stone: ${j.novos} movimentos novos de ${j.linhas} (${new Date(j.de).toLocaleDateString("pt-BR")} a ${new Date(j.ate).toLocaleDateString("pt-BR")}).` });
      carregar();
    } catch (e) { setMsg({ t: (e as Error).message, erro: true }); } finally { setOcupado(false); }
  }
  async function classificar(m: Movimento, tipo: string, categoria: string | null) {
    try {
      const x = await api<{ aplicadas: number }>(`/api/financeiro/externos/${m.id}`, { method: "PATCH", body: { tipo, categoria, lembrar } });
      if (x.aplicadas) setMsg({ t: `Regra salva: mais ${x.aplicadas} saídas desse nome classificadas.` });
      carregar();
    } catch (e) { setMsg({ t: (e as Error).message, erro: true }); }
  }
  async function apagarRegra(id: string) {
    try { await api(`/api/financeiro/regras/${id}`, { method: "DELETE" }); carregar(); } catch (e) { setMsg({ t: (e as Error).message, erro: true }); }
  }

  const lista = saidas.filter((m) => filtro === "todas" || (m.tipo === "PAGAMENTO" && !m.categoria));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div><label className="rotulo">Mês</label><input type="month" className="campo" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} /></div>
        <button className="btn" disabled={ocupado} onClick={() => sincronizar(false)}><RefreshCw size={14} className={ocupado ? "animate-spin" : ""} /> Atualizar Celcash</button>
        <label className={`btn cursor-pointer ${ocupado ? "pointer-events-none opacity-50" : ""}`}>
          <Upload size={14} /> Subir extrato da Stone (CSV)
          <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { void subirStone(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
        <span className="text-xs text-zinc-500">
          {r?.sincronizadoAte.CELCASH && <>Celcash até {quando(r.sincronizadoAte.CELCASH)} · </>}
          {r?.sincronizadoAte.STONE ? <>Stone até {quando(r.sincronizadoAte.STONE)}</> : "Stone: nenhum extrato"}
        </span>
      </div>
      {msg && <p className={`rounded-xl p-3 text-sm ${msg.erro ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"}`}>{msg.t}</p>}
      {!r ? <p className="cartao text-sm text-zinc-500">Carregando…</p> : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="cartao"><p className="text-xs text-zinc-500">Faturamento registrado</p><p className="text-2xl font-black">{reais(r.registrado.total)}</p></div>
            <div className="cartao"><p className="text-xs text-zinc-500">Caiu nas contas</p><p className="text-2xl font-black">{reais(r.celcash.recebido + r.stone.recebido)}</p><p className="text-[11px] text-zinc-500">Celcash {reais(r.celcash.recebido)} · Stone {reais(r.stone.recebido)}</p></div>
            <div className="cartao"><p className="text-xs text-zinc-500">Despesas + taxas</p><p className="text-2xl font-black">{reais(r.despesas.total + r.custos.total)}</p>{!!r.retiradas && <p className="text-[11px] text-zinc-500">retiradas do sócio {reais(r.retiradas)} (fora do lucro)</p>}</div>
            <div className="cartao-destaque"><p className="text-xs text-zinc-500">Lucro</p><p className={`text-2xl font-black ${r.lucro >= 0 ? "text-ouro" : "text-red-600"}`}>{reais(r.lucro)}</p></div>
          </div>

          {r.alertas.length > 0 && (
            <section className="space-y-1.5 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
              {r.alertas.map((a) => <p key={a} className="flex gap-2"><AlertTriangle size={16} className="mt-0.5 shrink-0" /> {a}</p>)}
            </section>
          )}

          <div className="grid gap-4 lg:grid-cols-4">
            <section className="cartao">
              <h2 className="mb-2 font-semibold">Registrado no BarberOS</h2>
              {Object.entries(r.registrado.porForma).map(([f, v]) => <Linha key={f} r={`Comandas · ${FORMA[f] ?? f}`} v={v} />)}
              <Linha r="Mensalidades dos planos" v={r.registrado.mensalidades} />
              {!!r.registrado.antecipados && <Linha r="Pagos antes pelo link" v={r.registrado.antecipados} />}
              {!!r.registrado.links && <Linha r="Links de pagamento" v={r.registrado.links} />}
              {!!r.registrado.estornos && <Linha r="Estornos" v={r.registrado.estornos} neg />}
              <div className="mt-1 border-t border-zinc-200 pt-1"><Linha r="Faturamento" v={r.registrado.total} forte /></div>
            </section>

            <section className="cartao">
              <h2 className="mb-2 font-semibold">Celcash (planos)</h2>
              {Object.entries(r.celcash.recebidoPorForma).map(([f, v]) => <Linha key={f} r={`Recebido · ${FORMA[f] ?? f}`} v={v} />)}
              <Linha r="Taxas, antecipação e tarifas" v={r.celcash.custoGateway} neg />
              <Linha r="Estornos" v={r.celcash.estornos} neg />
              <Linha r="Repassado para a Stone" v={r.celcash.transferidoParaEmpresa} neg />
              {!!r.celcash.pagamentos && <Linha r="Pagamentos a terceiros" v={r.celcash.pagamentos} neg />}
              <Dif r="Celcash − mensalidades" v={r.divergencias.mensalidades} />
            </section>

            <section className="cartao">
              <h2 className="mb-2 font-semibold">Stone (maquininha e conta)</h2>
              {Object.entries(r.stone.recebidoPorForma).map(([f, v]) => <Linha key={f} r={`Recebido · ${FORMA[f] ?? f}`} v={v} />)}
              <Linha r="Tarifas" v={r.stone.custoGateway} neg />
              <Linha r="Veio da Celcash" v={r.stone.voltouDaEmpresa} />
              <Linha r="Pagamentos (despesas)" v={r.stone.despesa} neg />
              <Linha r="Retiradas do sócio" v={r.stone.retiradas} neg />
              {!!r.stone.semCategoria && <Linha r="Saídas a classificar" v={r.stone.semCategoria} neg cor="text-amber-700" />}
              <Dif r="Stone cartão − comandas cartão (taxa e prazo)" v={r.divergencias.cartao} />
              <Dif r="Stone Pix − comandas Pix" v={r.divergencias.pix} />
            </section>

            <section className="cartao">
              <h2 className="mb-2 font-semibold">Lucro do mês</h2>
              <Linha r="Faturamento registrado" v={r.registrado.total} />
              <Linha r="Taxas Celcash" v={r.custos.celcash} neg />
              <Linha r="Tarifas Stone" v={r.custos.stone} neg />
              <Linha r="Taxa da maquininha (estimada)" v={r.custos.maquininhaEstimada} neg />
              <Linha r="Despesas" v={r.despesas.total} neg />
              <div className="mt-1 border-t border-zinc-200 pt-1"><Linha r="Lucro" v={r.lucro} forte cor={r.lucro >= 0 ? "text-ouro" : "text-red-600"} /></div>
              <div className="mt-2 space-y-0.5">
                {Object.entries(r.despesas.porCategoria).sort((a, b) => b[1] - a[1]).map(([c, v]) => <Linha key={c} r={`· ${ROTULO_SAIDA[c] ?? c}`} v={v} />)}
              </div>
              <p className="mt-2 text-[11px] text-zinc-500">A taxa da maquininha usa as taxas da aba Conciliação. Dinheiro em espécie só aparece pelo fechamento do caixa.</p>
            </section>
          </div>

          <section className="cartao">
            <div className="mb-2 flex flex-wrap items-center gap-3">
              <h2 className="font-semibold">Saídas do mês</h2>
              <select className="campo w-auto py-1 text-xs" value={filtro} onChange={(e) => setFiltro(e.target.value as "sem" | "todas")}>
                <option value="sem">Só as sem categoria</option>
                <option value="todas">Todas</option>
              </select>
              <label className="flex items-center gap-1.5 text-xs text-zinc-600"><input type="checkbox" className="h-3.5 w-3.5 accent-[#d3ab45]" checked={lembrar} onChange={(e) => setLembrar(e.target.checked)} /> Lembrar para esse nome (próximos meses)</label>
            </div>
            {!lista.length ? <p className="text-sm text-zinc-500">{filtro === "sem" ? "Tudo classificado neste mês." : "Nenhuma saída neste mês."}</p> : (
              <ul className="divide-y divide-zinc-200">
                {lista.slice(0, 300).map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                    <span className="w-24 text-xs text-zinc-500">{quando(m.data)}</span>
                    <span className="rounded bg-zinc-100 px-1.5 text-[10px] font-bold text-zinc-600">{m.fonte === "STONE" ? "Stone" : "Celcash"}</span>
                    <span className="min-w-40 flex-1">{m.observacao ?? m.descricao}</span>
                    <b className="w-28 text-right">{reais(Math.abs(m.valorCentavos))}</b>
                    <select className="campo w-auto py-1 text-xs" value={m.tipo === "TRANSFERENCIA" ? "TRANSFERENCIA" : m.categoria ?? ""}
                      onChange={(e) => (e.target.value === "TRANSFERENCIA" ? classificar(m, "TRANSFERENCIA", null) : classificar(m, "PAGAMENTO", e.target.value || null))}>
                      <option value="TRANSFERENCIA">Transferência entre contas da empresa</option>
                      <option value="">A classificar</option>
                      {CATEGORIAS_SAIDA.map((c) => <option key={c} value={c}>{ROTULO_SAIDA[c] ?? c}</option>)}
                    </select>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {regras.length > 0 && (
            <details className="cartao">
              <summary className="cursor-pointer font-semibold">Regras por nome ({regras.length})</summary>
              <ul className="mt-2 divide-y divide-zinc-200 text-sm">
                {regras.map((g) => (
                  <li key={g.id} className="flex items-center gap-2 py-1.5">
                    <span className="flex-1 font-mono text-xs">{g.padrao}</span>
                    <span className="text-xs text-zinc-600">{g.tipo === "PAGAMENTO" ? ROTULO_SAIDA[g.categoria ?? ""] ?? "a classificar" : "Transferência"}</span>
                    <button className="rounded p-1 text-zinc-500 hover:bg-red-50 hover:text-red-600" onClick={() => apagarRegra(g.id)} aria-label="Apagar regra"><Trash2 size={13} /></button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}
