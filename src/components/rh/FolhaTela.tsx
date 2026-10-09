"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Download, Lock, Plus, RotateCcw, Trash2, Wallet } from "lucide-react";
import { api, paraCentavos, reais } from "@/lib/cliente-api";

type Tipo = "ADICIONAL" | "BONUS" | "VALE" | "DESCONTO";
type Lanc = { id: string; tipo: Tipo; valorCentavos: number; descricao: string; doCaixa: boolean };
type Soma = { qtd: number; base: number; comissao: number };
type Linha = {
  pessoaId: string; nome: string; cargo: string | null; chavePix: string | null; barbeiro: string | null; ativo: boolean;
  salario: number; comissao: number; adicionais: number; descontos: number; liquido: number;
  status: "ABERTA" | "FECHADA" | "PAGA"; pagoEm: string | null; mudouDepois: boolean;
  comissaoDetalhe: { avulso: Soma; plano: Soma; semRegra: number } | null; lancamentos: Lanc[];
};
type Dados = { competencia: string; linhas: Linha[] };

const TIPOS: { v: Tipo; r: string; soma: boolean }[] = [
  { v: "ADICIONAL", r: "Adicional", soma: true }, { v: "BONUS", r: "Bônus", soma: true },
  { v: "VALE", r: "Vale", soma: false }, { v: "DESCONTO", r: "Desconto", soma: false },
];
const STATUS = { ABERTA: "Prévia", FECHADA: "Fechada", PAGA: "Paga" };
const FORMAS = [{ v: "PIX", r: "Pix" }, { v: "TRANSFERENCIA", r: "Transferência" }, { v: "DINHEIRO_CAIXA", r: "Dinheiro do caixa" }];

/** Folha do mes: previa ao vivo, lancamentos, fechar, pagar (gera despesa) e reabrir. */
export function FolhaTela() {
  const [d, setD] = useState<Dados | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  const [form, setForm] = useState({ tipo: "VALE" as Tipo, valor: "", descricao: "", doCaixa: false });
  const [forma, setForma] = useState("PIX");
  const [msg, setMsg] = useState<{ t: string; erro?: boolean } | null>(null);

  const carregar = useCallback((comp?: string) => {
    api<Dados>(`/api/rh/folha${comp ? `?competencia=${comp}` : ""}`).then(setD).catch((e) => setMsg({ t: e.message, erro: true }));
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  async function acao(body: Record<string, unknown>, ok: string, confirmar?: string) {
    if (!d || (confirmar && !confirm(confirmar))) return;
    setMsg(null);
    try {
      setD(await api<Dados>("/api/rh/folha", { method: "POST", body: { competencia: d.competencia, ...body } }));
      setMsg({ t: ok });
    } catch (e) {
      setMsg({ t: (e as Error).message, erro: true });
    }
  }

  async function lancar(pessoaId: string) {
    if (!d) return;
    const valorCentavos = paraCentavos(form.valor);
    if (!valorCentavos || Number.isNaN(valorCentavos)) return setMsg({ t: "Informe o valor.", erro: true });
    setMsg(null);
    try {
      await api("/api/rh/folha/lancamentos", { method: "POST", body: { competencia: d.competencia, pessoaId, tipo: form.tipo, valorCentavos, descricao: form.descricao, doCaixa: form.tipo === "VALE" && form.doCaixa } });
      setForm({ ...form, valor: "", descricao: "", doCaixa: false });
      setMsg({ t: form.tipo === "VALE" && form.doCaixa ? "Vale lançado e retirado do caixa (sangria)." : "Lançamento registrado." });
      carregar(d.competencia);
    } catch (e) {
      setMsg({ t: (e as Error).message, erro: true });
    }
  }

  async function excluir(id: string) {
    if (!d || !confirm("Apagar este lançamento?")) return;
    try {
      await api(`/api/rh/folha/lancamentos?id=${id}`, { method: "DELETE" });
      carregar(d.competencia);
    } catch (e) {
      setMsg({ t: (e as Error).message, erro: true });
    }
  }

  if (!d) return <div className="cartao text-sm text-zinc-500">{msg?.t ?? "Carregando…"}</div>;
  const visiveis = d.linhas.filter((l) => l.ativo || l.status !== "ABERTA" || l.lancamentos.length);
  const total = visiveis.reduce((t, l) => t + l.liquido, 0);
  const abertas = visiveis.filter((l) => l.status === "ABERTA" && (l.salario || l.comissao || l.lancamentos.length)).length;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div><label className="rotulo">Competência</label><input type="month" className="campo" value={d.competencia} onChange={(e) => e.target.value && carregar(e.target.value)} /></div>
        <button className="btn-primario" disabled={!abertas} onClick={() => acao({ acao: "fechar" }, "Folha fechada: valores congelados.", `Fechar a folha de ${d.competencia.split("-").reverse().join("/")}? Os valores ficam congelados.`)}><Lock size={15} /> Fechar folha{abertas ? ` (${abertas})` : ""}</button>
        <a className="btn" href={`/api/rh/folha/csv?competencia=${d.competencia}`}><Download size={15} /> Exportar CSV</a>
        <div className="ml-auto text-right"><p className="text-xs text-zinc-500">Líquido total</p><p className="text-xl font-black text-ouro">{reais(total)}</p></div>
      </div>
      {msg && <p className={`rounded-xl p-3 text-sm ${msg.erro ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"}`}>{msg.t}</p>}
      {visiveis.length === 0 && <div className="cartao text-sm text-zinc-500">Ninguém na folha. Cadastre os funcionários no checklist e preencha a ficha na aba Funcionários.</div>}
      {visiveis.map((l) => (
        <section key={l.pessoaId} className="cartao space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <button className="flex flex-1 items-center gap-2 text-left" onClick={() => setAberto(aberto === l.pessoaId ? null : l.pessoaId)}>
              {aberto === l.pessoaId ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              <span>
                <span className="font-semibold">{l.nome}</span>
                <span className="block text-xs text-zinc-500">{l.cargo ?? "Sem cargo"}{l.barbeiro ? ` · agenda: ${l.barbeiro}` : ""}</span>
              </span>
            </button>
            <span className={l.status === "PAGA" ? "rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700" : l.status === "FECHADA" ? "selo-ouro" : "text-xs text-zinc-500"}>{STATUS[l.status]}</span>
            <span className="w-28 text-right text-lg font-black">{reais(l.liquido)}</span>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs sm:grid-cols-4">
            <span>Salário <b>{reais(l.salario)}</b></span>
            <span>Comissão <b>{reais(l.comissao)}</b></span>
            <span className="text-emerald-700">+ Adicionais <b>{reais(l.adicionais)}</b></span>
            <span className="text-red-600">− Vales/descontos <b>{reais(l.descontos)}</b></span>
          </div>
          {l.mudouDepois && <p className="text-xs text-amber-700">Os valores mudaram depois do fechamento (ex.: atendimento concluído depois). Reabra e feche de novo para atualizar.</p>}
          <div className="flex flex-wrap items-center gap-2">
            {l.status === "ABERTA" && (l.salario || l.comissao || l.lancamentos.length) > 0 && (
              <button className="btn py-1.5 text-xs" onClick={() => acao({ acao: "fechar", pessoaId: l.pessoaId }, `Folha de ${l.nome} fechada.`)}><Lock size={13} /> Fechar só esta</button>
            )}
            {l.status === "FECHADA" && (
              <>
                <select className="campo w-44 py-1.5 text-sm" value={forma} onChange={(e) => setForma(e.target.value)}>{FORMAS.map((f) => <option key={f.v} value={f.v}>{f.r}</option>)}</select>
                <button className="btn" onClick={() => acao({ acao: "pagar", pessoaId: l.pessoaId, forma }, `Folha de ${l.nome} paga e lançada nas despesas.`, `Marcar ${reais(l.liquido)} como pago para ${l.nome}?${l.chavePix ? `\nPix: ${l.chavePix}` : ""}`)}><Wallet size={15} /> Marcar como paga</button>
                <button className="btn" onClick={() => acao({ acao: "reabrir", pessoaId: l.pessoaId }, `Folha de ${l.nome} reaberta.`)}><RotateCcw size={15} /> Reabrir</button>
              </>
            )}
            {l.status === "PAGA" && l.pagoEm && <span className="text-xs text-zinc-500">Paga em {new Date(l.pagoEm).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}{l.chavePix ? ` · Pix ${l.chavePix}` : ""}</span>}
          </div>
          {aberto === l.pessoaId && (
            <div className="space-y-2 border-t border-zinc-200 pt-2 text-sm">
              {l.comissaoDetalhe && (
                <p className="text-xs text-zinc-500">
                  Comissão: {l.comissaoDetalhe.avulso.qtd} avulso(s) = {reais(l.comissaoDetalhe.avulso.comissao)} · {l.comissaoDetalhe.plano.qtd} pelo plano = {reais(l.comissaoDetalhe.plano.comissao)}
                  {l.comissaoDetalhe.semRegra > 0 && <span className="text-amber-700"> · {l.comissaoDetalhe.semRegra} sem regra</span>}
                </p>
              )}
              {l.lancamentos.length === 0 ? <p className="text-xs text-zinc-500">Sem lançamentos no mês.</p> : (
                <ul className="space-y-1">
                  {l.lancamentos.map((x) => {
                    const t = TIPOS.find((y) => y.v === x.tipo)!;
                    return (
                      <li key={x.id} className="flex items-center gap-2 text-xs">
                        <span className="w-20 font-semibold">{t.r}</span>
                        <span className="flex-1">{x.descricao}{x.doCaixa && <span className="ml-1 text-zinc-500">(saiu do caixa)</span>}</span>
                        <span className={`font-bold ${t.soma ? "text-emerald-700" : "text-red-600"}`}>{t.soma ? "+" : "−"}{reais(x.valorCentavos)}</span>
                        {l.status === "ABERTA" && !x.doCaixa && <button className="rounded p-1 text-zinc-500 hover:text-red-600" title="Apagar" onClick={() => excluir(x.id)}><Trash2 size={13} /></button>}
                      </li>
                    );
                  })}
                </ul>
              )}
              {l.status === "ABERTA" && (
                <div className="flex flex-wrap items-end gap-2">
                  <div><label className="rotulo">Tipo</label><select className="campo py-1.5" value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value as Tipo })}>{TIPOS.map((t) => <option key={t.v} value={t.v}>{t.r}</option>)}</select></div>
                  <div><label className="rotulo">Valor (R$)</label><input className="campo w-28 py-1.5" inputMode="decimal" value={form.valor} onChange={(e) => setForm({ ...form, valor: e.target.value })} /></div>
                  <div className="min-w-40 flex-1"><label className="rotulo">Descrição</label><input className="campo py-1.5" placeholder="Ex.: vale do dia 10" value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} /></div>
                  {form.tipo === "VALE" && (
                    <label className="flex items-center gap-1.5 pb-2 text-xs"><input type="checkbox" className="h-4 w-4 accent-[#d3ab45]" checked={form.doCaixa} onChange={(e) => setForm({ ...form, doCaixa: e.target.checked })} /> Pagar com dinheiro do caixa</label>
                  )}
                  <button className="btn" onClick={() => lancar(l.pessoaId)}><Plus size={15} /> Lançar</button>
                </div>
              )}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
