"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowDownCircle, ArrowUpCircle, Lock, LockOpen, Receipt, TriangleAlert } from "lucide-react";
import { useAcesso } from "@/components/AcessoContexto";
import { api, paraCentavos, reais } from "@/lib/cliente-api";
import { ExtratoCaixa } from "./ExtratoCaixa";

type Totais = Record<"DINHEIRO" | "PIX" | "DEBITO" | "CREDITO" | "ONLINE", number>;
type Mov = { id: string; tipo: "SANGRIA" | "SUPRIMENTO"; valorCentavos: number; motivo: string; criadoEm: string };
type Aberto = {
  id: string; abertoEm: string; fundoCentavos: number; abertoPor: string | null; totais: Totais; troco: number; suprimentos: number;
  sangrias: number; esperado: number; comandasFechadas: number; faturado: number; ticketMedio: number; comandasAbertas: number; movimentos: Mov[];
};
type Fechado = {
  id: string; abertoEm: string; fechadoEm: string; fundoCentavos: number; contadoCentavos: number; esperadoCentavos: number; diferencaCentavos: number;
  observacao: string | null; abertoPor: string | null; fechadoPor: string | null; resumo: { totais: Totais; faturado: number; comandasFechadas: number } | null;
};
type Painel = { aberto: Aberto | null; fechados: Fechado[] };

const FORMAS: { k: keyof Totais; r: string }[] = [
  { k: "DINHEIRO", r: "Dinheiro" }, { k: "PIX", r: "Pix" }, { k: "DEBITO", r: "Débito" }, { k: "CREDITO", r: "Crédito" }, { k: "ONLINE", r: "Online (pago antes)" },
];
const hora = (d: string) => new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
const sinal = (c: number) => (c > 0 ? `+${reais(c)}` : reais(c));

/**
 * Abertura, sangria/suprimento e fechamento do caixa, com historico dos fechamentos e o extrato de cada turno.
 * `compacto` (gaveta da recepcao): uma coluna, sem historico e com o extrato resumido do turno atual.
 */
export function CaixaTela({ compacto = false }: { compacto?: boolean } = {}) {
  const podeMexer = useAcesso().permissoes.caixa;
  const [p, setP] = useState<Painel | null>(null);
  const [msg, setMsg] = useState<{ t: string; erro?: boolean } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [fundo, setFundo] = useState("");
  const [mov, setMov] = useState<{ tipo: "sangria" | "suprimento"; valor: string; motivo: string } | null>(null);
  const [fechar, setFechar] = useState<{ contado: string; obs: string } | null>(null);
  const [verMov, setVerMov] = useState(false);
  const [detalhe, setDetalhe] = useState<string | null>(null);
  const [versao, setVersao] = useState(0);

  const atualizar = useCallback((x: Painel) => { setP(x); setVersao((v) => v + 1); }, []);
  const carregar = useCallback(() => api<Painel>("/api/financeiro/caixa").then(atualizar).catch((e) => setMsg({ t: e.message, erro: true })), [atualizar]);
  useEffect(() => { carregar(); }, [carregar]);

  async function enviar(body: Record<string, unknown>, ok: string) {
    setMsg(null);
    setOcupado(true);
    try {
      const r = await api<Painel | { diferenca: number }>("/api/financeiro/caixa", { method: "POST", body });
      if ("aberto" in r) atualizar(r); else await carregar();
      setMsg({ t: ok });
      setMov(null);
      setFechar(null);
    } catch (e) {
      setMsg({ t: (e as Error).message, erro: true });
    } finally {
      setOcupado(false);
    }
  }

  if (!p) return <div className="cartao text-sm text-zinc-500">{msg?.t ?? "Carregando…"}</div>;
  const a = p.aberto;
  const contado = fechar ? paraCentavos(fechar.contado || "0") : NaN;
  const dif = a && Number.isFinite(contado) ? contado - a.esperado : 0;

  return (
    <div className="space-y-4">
      {msg && <p className={`rounded-xl p-3 text-sm ${msg.erro ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"}`}>{msg.t}</p>}

      {!a ? (
        <section className="cartao space-y-3">
          <h2 className="flex items-center gap-2 font-semibold"><Lock size={18} className="text-zinc-500" /> Caixa fechado</h2>
          {!podeMexer && <p className="text-sm text-zinc-500">Seu acesso não abre o caixa. Fale com o dono.</p>}
          {podeMexer && <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); const v = paraCentavos(fundo || "0"); if (!Number.isFinite(v)) return setMsg({ t: "Valor inválido.", erro: true }); enviar({ acao: "abrir", fundoCentavos: v }, "Caixa aberto."); }}>
            <div>
              <label className="rotulo">Fundo de troco (dinheiro na gaveta)</label>
              <input className="campo w-44" inputMode="decimal" placeholder="Ex.: 150,00" value={fundo} onChange={(e) => setFundo(e.target.value)} />
            </div>
            <button className="btn-primario" disabled={ocupado}><LockOpen size={16} /> Abrir caixa</button>
          </form>}
        </section>
      ) : (
        <section className="cartao-destaque space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="flex items-center gap-2 font-semibold"><LockOpen size={18} className="text-ouro" /> Caixa aberto</h2>
              <p className="text-xs text-zinc-500">Desde {hora(a.abertoEm)}{a.abertoPor ? ` por ${a.abertoPor}` : ""} · fundo {reais(a.fundoCentavos)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-zinc-500">Dinheiro que deve ter na gaveta</p>
              <p className="text-2xl font-black text-ouro">{reais(a.esperado)}</p>
            </div>
          </div>

          <div className={`grid grid-cols-2 gap-2 ${compacto ? "" : "sm:grid-cols-5"}`}>
            {FORMAS.map((f) => (
              <div key={f.k} className="rounded-xl border border-zinc-200 p-3">
                <p className="text-[11px] text-zinc-500">{f.r}</p>
                <p className="font-bold">{reais(a.totais[f.k] ?? 0)}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-zinc-500">
            {a.comandasFechadas} comandas fechadas · faturado {reais(a.faturado)} · ticket médio {reais(a.ticketMedio)} · troco dado {reais(a.troco)}
            {a.suprimentos ? ` · entradas ${reais(a.suprimentos)}` : ""}{a.sangrias ? ` · retiradas ${reais(a.sangrias)}` : ""}
          </p>
          {a.comandasAbertas > 0 && (
            <p className="flex items-center gap-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900"><TriangleAlert size={14} /> {a.comandasAbertas} comanda(s) ainda aberta(s): feche antes de fechar o caixa.</p>
          )}

          {!compacto && !verMov && a.movimentos.length > 0 && (
            <ul className="divide-y divide-zinc-200 text-sm">
              {a.movimentos.map((m) => (
                <li key={m.id} className="flex items-center gap-2 py-1.5">
                  {m.tipo === "SANGRIA" ? <ArrowUpCircle size={15} className="text-red-600" /> : <ArrowDownCircle size={15} className="text-emerald-600" />}
                  <span className="flex-1">{m.tipo === "SANGRIA" ? "Retirada do caixa" : "Entrada no caixa"} · {m.motivo}</span>
                  <span className="text-xs text-zinc-500">{hora(m.criadoEm)}</span>
                  <b>{m.tipo === "SANGRIA" ? "-" : "+"}{reais(m.valorCentavos)}</b>
                </li>
              ))}
            </ul>
          )}

          {mov ? (
            <form className={`grid gap-2 rounded-xl border border-zinc-200 p-3 ${compacto ? "" : "sm:grid-cols-[140px_1fr_auto]"}`} onSubmit={(e) => { e.preventDefault(); const v = paraCentavos(mov.valor); if (!(v > 0)) return setMsg({ t: "Informe o valor.", erro: true }); enviar({ acao: mov.tipo, valorCentavos: v, motivo: mov.motivo }, mov.tipo === "sangria" ? "Retirada registrada." : "Entrada registrada."); }}>
              <input className="campo" inputMode="decimal" placeholder="Valor" value={mov.valor} onChange={(e) => setMov({ ...mov, valor: e.target.value })} autoFocus />
              <input className="campo" placeholder={mov.tipo === "sangria" ? "Motivo (ex.: depósito no banco, pagou fornecedor)" : "Motivo (ex.: reforço de troco)"} value={mov.motivo} onChange={(e) => setMov({ ...mov, motivo: e.target.value })} />
              <div className="flex gap-2"><button className="btn-primario" disabled={ocupado}>Salvar</button><button type="button" className="btn" onClick={() => setMov(null)}>Cancelar</button></div>
            </form>
          ) : fechar ? (
            <form className="space-y-2 rounded-xl border border-zinc-200 p-3" onSubmit={(e) => { e.preventDefault(); if (!Number.isFinite(contado)) return setMsg({ t: "Valor contado inválido.", erro: true }); enviar({ acao: "fechar", contadoCentavos: contado, ...(fechar.obs ? { observacao: fechar.obs } : {}) }, "Caixa fechado."); }}>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="rotulo">Dinheiro contado na gaveta</label>
                  <input className="campo w-44" inputMode="decimal" placeholder="0,00" value={fechar.contado} onChange={(e) => setFechar({ ...fechar, contado: e.target.value })} autoFocus />
                </div>
                {fechar.contado && Number.isFinite(contado) && (
                  <p className={`pb-2 text-sm font-bold ${dif === 0 ? "text-emerald-600" : "text-red-600"}`}>
                    {dif === 0 ? "Bateu certinho ✓" : dif > 0 ? `Sobrou ${reais(dif)}` : `Faltou ${reais(-dif)}`}
                  </p>
                )}
              </div>
              {dif !== 0 && <input className="campo" placeholder="O que aconteceu? (obrigatório quando não bate)" value={fechar.obs} onChange={(e) => setFechar({ ...fechar, obs: e.target.value })} />}
              <div className="flex gap-2"><button className="btn-primario" disabled={ocupado}><Lock size={15} /> Fechar caixa</button><button type="button" className="btn" onClick={() => setFechar(null)}>Voltar</button></div>
            </form>
          ) : (
            <div className={compacto ? "grid grid-cols-2 gap-2 [&>*]:min-w-0 [&>*]:w-full [&>*]:px-2" : "flex flex-wrap gap-2"}>
              {podeMexer && <button className="btn acao-caixa-entrada" onClick={() => setMov({ tipo: "suprimento", valor: "", motivo: "" })}><ArrowDownCircle size={15} /> Entrada no caixa</button>}
              {podeMexer && <button className="btn acao-caixa-retirada" onClick={() => setMov({ tipo: "sangria", valor: "", motivo: "" })}><ArrowUpCircle size={15} /> Retirada do caixa</button>}
              {compacto && <Link href="/comandas" className="btn"><Receipt size={15} /> Comandas</Link>}
              {!compacto && <button className="btn" onClick={() => setVerMov(!verMov)}><Receipt size={15} /> {verMov ? "Esconder movimentação" : "Ver movimentação"}</button>}
              {podeMexer && <button className={`btn-primario ${compacto ? "" : "ml-auto"}`} onClick={() => setFechar({ contado: "", obs: "" })}><Lock size={15} /> Fechar caixa</button>}
            </div>
          )}

          {(compacto || verMov) && (
            <div className="rounded-xl border border-zinc-200 p-3">
              <ExtratoCaixa caixaId={a.id} versao={versao} compacto={compacto} onFechar={compacto ? undefined : () => setVerMov(false)} />
            </div>
          )}
        </section>
      )}

      {compacto && <nav aria-label="Atalhos do caixa" className="flex flex-wrap gap-2">
        {(!a || mov || fechar) && <Link href="/comandas" className="btn"><Receipt size={15} /> Comandas</Link>}
        <Link href="/caixa" className="btn">Caixa completo e fechamentos</Link>
      </nav>}
      <p className="text-xs text-zinc-500">Entrada e retirada movimentam o dinheiro da gaveta. Cadastre receitas e despesas do negócio no Financeiro.</p>

      {!compacto && detalhe && (
        <section className="cartao">
          <ExtratoCaixa caixaId={detalhe} onFechar={() => setDetalhe(null)} />
        </section>
      )}

      {!compacto && <section className="cartao">
        <h2 className="mb-2 font-semibold">Fechamentos anteriores</h2>
        {p.fechados.length > 0 && <p className="mb-2 text-xs text-zinc-500">Clique numa linha para ver a movimentação daquele caixa.</p>}
        {p.fechados.length === 0 ? <p className="text-sm text-zinc-500">Nenhum caixa fechado ainda.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm [&_td]:px-2 [&_th]:px-2">
              <thead className="text-left text-[11px] uppercase tracking-wider text-zinc-500">
                <tr><th className="py-2">Fechado</th><th>Por</th><th className="text-right">Faturado</th><th className="text-right">Esperado</th><th className="text-right">Contado</th><th className="text-right">Diferença</th></tr>
              </thead>
              <tbody className="divide-y divide-zinc-200">
                {p.fechados.map((f) => (
                  <tr key={f.id} title={f.observacao ?? "Ver movimentação"} onClick={() => { setDetalhe(f.id); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                    className={`cursor-pointer hover:bg-zinc-50 ${detalhe === f.id ? "bg-zinc-50" : ""}`}>
                    <td className="py-2">{hora(f.fechadoEm)}</td>
                    <td>{f.fechadoPor ?? "—"}</td>
                    <td className="text-right">{reais(f.resumo?.faturado ?? 0)}</td>
                    <td className="text-right">{reais(f.esperadoCentavos)}</td>
                    <td className="text-right">{reais(f.contadoCentavos)}</td>
                    <td className={`text-right font-bold ${f.diferencaCentavos === 0 ? "text-emerald-600" : "text-red-600"}`}>
                      {f.diferencaCentavos === 0 ? "OK" : sinal(f.diferencaCentavos)}
                      {f.observacao && <span className="block text-[11px] font-normal text-zinc-500">{f.observacao}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>}
    </div>
  );
}
