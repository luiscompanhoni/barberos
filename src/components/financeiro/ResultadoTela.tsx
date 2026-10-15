"use client";

/**
 * Resultado do mes (conciliacao): o faturamento registrado no BarberOS ao lado do que caiu na Celcash,
 * as taxas, os estornos, as saidas (transferencias para a empresa e pagamentos a terceiros) e o lucro,
 * com as divergencias marcadas. As saidas da Celcash para terceiros sao classificadas aqui.
 */
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { api, reais } from "@/lib/cliente-api";
import { CATEGORIAS_DESPESA, ROTULO_CATEGORIA } from "@/lib/financeiro/regras";
import { mesAtual } from "./DespesasTela";

type Resultado = {
  mes: string; sincronizadoAte: string | null;
  registrado: { total: number; comandas: number; porForma: Record<string, number>; mensalidades: number; antecipados: number; links: number; estornos: number };
  celcash: {
    recebido: number; recebidoPorForma: Record<string, number>; taxas: number; antecipacao: number; tarifas: number; estornos: number; custoGateway: number;
    liquido: number; transferidoParaEmpresa: number; voltouDaEmpresa: number; pagamentos: number; pagamentosSemCategoria: number; pagamentosDespesa: number; retiradas: number;
  };
  despesas: { barberos: number; celcash: number; total: number };
  lucro: number; divergencias: { mensalidades: number }; alertas: string[];
};
type Movimento = { id: string; data: string; valorCentavos: number; tipo: string; forma: string | null; descricao: string; categoria: string | null; observacao: string | null; classificadoPorId: string | null };

const FORMA: Record<string, string> = { DINHEIRO: "Dinheiro", PIX: "Pix", DEBITO: "Débito", CREDITO: "Crédito", CARTAO: "Cartão", BOLETO: "Boleto" };
const CATEGORIAS_SAIDA = [...CATEGORIAS_DESPESA, "RETIRADA_SOCIO", "JA_LANCADA"];
const ROTULO_SAIDA: Record<string, string> = { ...ROTULO_CATEGORIA, RETIRADA_SOCIO: "Retirada do sócio (não é despesa)", JA_LANCADA: "Já lançada em Despesas" };
const quando = (d: string) => new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

function Linha({ r, v, forte, neg, cor }: { r: string; v: number; forte?: boolean; neg?: boolean; cor?: string }) {
  return (
    <div className={`flex justify-between gap-3 py-1 text-sm ${forte ? "font-bold" : ""}`}>
      <span className="text-zinc-600">{r}</span>
      <span className={cor}>{neg && v ? "− " : ""}{reais(Math.abs(v))}</span>
    </div>
  );
}

export function ResultadoTela() {
  const [mes, setMes] = useState(mesAtual);
  const [r, setR] = useState<Resultado | null>(null);
  const [saidas, setSaidas] = useState<Movimento[]>([]);
  const [msg, setMsg] = useState<{ t: string; erro?: boolean } | null>(null);
  const [sinc, setSinc] = useState(false);

  const carregar = useCallback(() => {
    api<Resultado>(`/api/financeiro/resultado?mes=${mes}`).then(setR).catch((e) => setMsg({ t: e.message, erro: true }));
    Promise.all([
      api<Movimento[]>(`/api/financeiro/externos?mes=${mes}&tipo=PAGAMENTO`),
      api<Movimento[]>(`/api/financeiro/externos?mes=${mes}&tipo=TRANSFERENCIA`),
    ]).then(([p, t]) => setSaidas([...p, ...t].sort((a, b) => b.data.localeCompare(a.data)))).catch(() => {});
  }, [mes]);
  useEffect(() => { carregar(); }, [carregar]);

  async function sincronizar(historico: boolean) {
    setSinc(true); setMsg(null);
    try {
      const x = await api<{ novos: number }>("/api/financeiro/externos/sincronizar", { method: "POST", body: { historico } });
      setMsg({ t: x.novos ? `${x.novos} movimentos novos da Celcash.` : "Extrato já estava em dia." });
      carregar();
    } catch (e) { setMsg({ t: (e as Error).message, erro: true }); } finally { setSinc(false); }
  }
  async function classificar(m: Movimento, tipo: string, categoria: string | null) {
    try { await api(`/api/financeiro/externos/${m.id}`, { method: "PATCH", body: { tipo, categoria } }); carregar(); } catch (e) { setMsg({ t: (e as Error).message, erro: true }); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div><label className="rotulo">Mês</label><input type="month" className="campo" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} /></div>
        <button className="btn" disabled={sinc} onClick={() => sincronizar(false)}><RefreshCw size={14} className={sinc ? "animate-spin" : ""} /> Atualizar extrato</button>
        <button className="btn" disabled={sinc} onClick={() => sincronizar(true)}>Trazer todo o histórico</button>
        {r?.sincronizadoAte && <span className="text-xs text-zinc-500">Celcash até {quando(r.sincronizadoAte)}</span>}
      </div>
      {msg && <p className={`rounded-xl p-3 text-sm ${msg.erro ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"}`}>{msg.t}</p>}
      {!r ? <p className="cartao text-sm text-zinc-500">Carregando…</p> : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="cartao"><p className="text-xs text-zinc-500">Faturamento registrado</p><p className="text-2xl font-black">{reais(r.registrado.total)}</p></div>
            <div className="cartao"><p className="text-xs text-zinc-500">Caiu na Celcash</p><p className="text-2xl font-black">{reais(r.celcash.recebido)}</p><p className="text-[11px] text-zinc-500">líquido {reais(r.celcash.liquido)}</p></div>
            <div className="cartao"><p className="text-xs text-zinc-500">Despesas + taxas</p><p className="text-2xl font-black">{reais(r.despesas.total + r.celcash.custoGateway)}</p></div>
            <div className="cartao-destaque"><p className="text-xs text-zinc-500">Lucro</p><p className={`text-2xl font-black ${r.lucro >= 0 ? "text-ouro" : "text-red-600"}`}>{reais(r.lucro)}</p></div>
          </div>

          {r.alertas.length > 0 && (
            <section className="space-y-1.5 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
              {r.alertas.map((a) => <p key={a} className="flex gap-2"><AlertTriangle size={16} className="mt-0.5 shrink-0" /> {a}</p>)}
            </section>
          )}

          <div className="grid gap-4 lg:grid-cols-3">
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
              <h2 className="mb-2 font-semibold">Extrato da Celcash</h2>
              {Object.entries(r.celcash.recebidoPorForma).map(([f, v]) => <Linha key={f} r={`Recebido · ${FORMA[f] ?? f}`} v={v} />)}
              <Linha r="Taxas das transações" v={r.celcash.taxas} neg />
              <Linha r="Antecipação" v={r.celcash.antecipacao} neg />
              <Linha r="Tarifas (WhatsApp, módulos)" v={r.celcash.tarifas} neg />
              <Linha r="Estornos" v={r.celcash.estornos} neg />
              <div className="mt-1 border-t border-zinc-200 pt-1"><Linha r="Líquido" v={r.celcash.liquido} forte /></div>
              <Linha r="Transferido para a empresa" v={r.celcash.transferidoParaEmpresa} neg />
              <Linha r="Pagamentos a terceiros" v={r.celcash.pagamentos} neg />
              <div className={`mt-2 rounded-lg p-2 text-xs ${Math.abs(r.divergencias.mensalidades) > 100 ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"}`}>
                Celcash − mensalidades registradas: <b>{reais(r.divergencias.mensalidades)}</b>
              </div>
            </section>

            <section className="cartao">
              <h2 className="mb-2 font-semibold">Lucro do mês</h2>
              <Linha r="Faturamento registrado" v={r.registrado.total} />
              <Linha r="Taxas, antecipação e tarifas" v={r.celcash.custoGateway} neg />
              <Linha r="Despesas pagas (BarberOS)" v={r.despesas.barberos} neg />
              <Linha r="Saídas da Celcash classificadas" v={r.despesas.celcash} neg />
              <div className="mt-1 border-t border-zinc-200 pt-1"><Linha r="Lucro" v={r.lucro} forte cor={r.lucro >= 0 ? "text-ouro" : "text-red-600"} /></div>
              {!!r.celcash.retiradas && <p className="mt-2 text-xs text-zinc-500">Retiradas do sócio no mês: {reais(r.celcash.retiradas)} (não entram no lucro).</p>}
              <p className="mt-2 text-[11px] text-zinc-500">Dinheiro em espécie só aparece pelo fechamento do caixa. Cartão e Pix da maquininha entram quando o extrato da Stone for ligado.</p>
            </section>
          </div>

          <section className="cartao">
            <h2 className="mb-2 font-semibold">Saídas da Celcash ({saidas.length})</h2>
            {!saidas.length ? <p className="text-sm text-zinc-500">Nenhuma saída neste mês.</p> : (
              <ul className="divide-y divide-zinc-200">
                {saidas.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                    <span className="w-24 text-xs text-zinc-500">{quando(m.data)}</span>
                    <span className="min-w-40 flex-1">{m.observacao ?? m.descricao}</span>
                    <b className="w-28 text-right">{reais(Math.abs(m.valorCentavos))}</b>
                    <select className="campo w-auto py-1 text-xs" value={m.tipo === "TRANSFERENCIA" ? "TRANSFERENCIA" : m.categoria ?? ""}
                      onChange={(e) => (e.target.value === "TRANSFERENCIA" ? classificar(m, "TRANSFERENCIA", null) : classificar(m, "PAGAMENTO", e.target.value || null))}>
                      <option value="TRANSFERENCIA">Transferência para a empresa</option>
                      <option value="">Pagamento: a classificar</option>
                      {CATEGORIAS_SAIDA.map((c) => <option key={c} value={c}>Pagamento: {ROTULO_SAIDA[c] ?? c}</option>)}
                    </select>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
