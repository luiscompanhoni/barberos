"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Download, Lock, Plus, RotateCcw, Trash2, Wallet } from "lucide-react";
import { api, paraCentavos, reais } from "@/lib/cliente-api";
import { GraficoBarrasCrm } from "@/components/visual/GraficoBarrasCrm";
import { ContadorCrm } from "@/components/visual/ContadorCrm";
import { LotePixFolha } from "./LotePixFolha";
import { ResumoRateioAssinaturas } from "./ResumoRateioAssinaturas";
import type { ConciliacaoAssinaturas } from "@/lib/rh/rateio-assinaturas";

type Tipo = "ADICIONAL" | "BONUS" | "VALE" | "DESCONTO";
type Lanc = { id: string; tipo: Tipo; valorCentavos: number; descricao: string; doCaixa: boolean };
type Soma = { qtd: number; base: number; comissao: number };
type Linha = {
  pessoaId: string; nome: string; cargo: string | null; chavePix: string | null; barbeiro: string | null; barbeiroId?: string | null; ativo: boolean;
  salario: number; comissao: number; adicionais: number; descontos: number; liquido: number;
  status: "ABERTA" | "FECHADA" | "PAGA"; pagoEm: string | null; mudouDepois: boolean; memoriaDisponivel?: boolean; vinculoPendente?: boolean;
  comissaoDetalhe: {
    avulso: Soma; plano: Soma; semRegra: number;
    assinaturas?: { qtd: number; creditos: number; receitaAtribuida: number; comissao: number } | null; produtos?: { vendido: number; comissao: number } | null;
  } | null; lancamentos: Lanc[];
};
type Dados = {
  competencia: string; linhas: Linha[]; revisao: string; recebimentos?: { completo: boolean; pendentes: number };
  pendenciasVinculos?: { barbeiroId: string; nome: string; comissaoCentavos: number; motivo: "SEM_VINCULO" | "INATIVO" | "AMBIGUO" }[];
  conciliacaoAssinaturas?: ConciliacaoAssinaturas | null;
};
const MOTIVOS_VINCULO = { SEM_VINCULO: "sem ficha vinculada", INATIVO: "ficha inativa", AMBIGUO: "destinatário sem identificação única" };

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
  const [ocupado, setOcupado] = useState(false);
  const geracao = useRef(0);
  const competenciaAtual = useRef<string | undefined>(undefined);
  const acaoEmVoo = useRef(false);
  const tentativaLancamento = useRef<string | null>(null);

  const carregar = useCallback(async (comp = competenciaAtual.current) => {
    const atual = ++geracao.current;
    competenciaAtual.current = comp;
    setD(null);
    try {
      const dados = await api<Dados>(`/api/rh/folha${comp ? `?competencia=${comp}` : ""}`);
      if (geracao.current !== atual) return false;
      competenciaAtual.current = dados.competencia;
      setD(dados);
      return true;
    } catch (e) {
      if (geracao.current === atual) setMsg({ t: (e as Error).message, erro: true });
      return false;
    }
  }, []);
  useEffect(() => {
    const atual = ++geracao.current;
    let ativo = true;
    api<Dados>("/api/rh/folha").then(dados => {
      if (!ativo || geracao.current !== atual) return;
      competenciaAtual.current = dados.competencia;
      setD(dados);
    }).catch((e: Error) => {
      if (ativo && geracao.current === atual) setMsg({ t: e.message, erro: true });
    });
    return () => { ativo = false; };
  }, []);

  async function acao(body: Record<string, unknown>, ok: string, confirmar?: string) {
    if (!d || acaoEmVoo.current || (confirmar && !confirm(confirmar))) return;
    acaoEmVoo.current = true;
    const atual = ++geracao.current;
    setOcupado(true);
    setMsg(null);
    try {
      const dados = await api<Dados>("/api/rh/folha", { method: "POST", body: { competencia: d.competencia, revisao: d.revisao, ...body } });
      if (geracao.current !== atual) return;
      setD(dados);
      setMsg({ t: ok });
    } catch (e) {
      if (geracao.current === atual) setMsg({ t: (e as Error).message, erro: true });
    } finally { acaoEmVoo.current = false; setOcupado(false); }
  }

  async function lancar(pessoaId: string) {
    if (!d || acaoEmVoo.current) return;
    const valorCentavos = paraCentavos(form.valor);
    if (!valorCentavos || Number.isNaN(valorCentavos)) return setMsg({ t: "Informe o valor.", erro: true });
    acaoEmVoo.current = true;
    const atual = ++geracao.current;
    setOcupado(true);
    setMsg(null);
    try {
      tentativaLancamento.current ??= crypto.randomUUID();
      await api("/api/rh/folha/lancamentos", { method: "POST", body: { competencia: d.competencia, pessoaId, tipo: form.tipo, valorCentavos, descricao: form.descricao, doCaixa: form.tipo === "VALE" && form.doCaixa, idempotencia: tentativaLancamento.current } });
      if (geracao.current !== atual) return;
      tentativaLancamento.current = null;
      setForm({ ...form, valor: "", descricao: "", doCaixa: false });
      if (await carregar(d.competencia)) setMsg({ t: form.tipo === "VALE" && form.doCaixa ? "Vale lançado e retirado do caixa (sangria)." : "Lançamento registrado." });
    } catch (e) {
      if (geracao.current === atual) {
        const texto = (e as Error).message;
        await carregar(d.competencia);
        if (geracao.current === atual + 1) setMsg({ t: `${texto} Confira os lançamentos antes de tentar novamente.`, erro: true });
      }
    } finally { acaoEmVoo.current = false; setOcupado(false); }
  }

  async function excluir(id: string) {
    if (!d || acaoEmVoo.current || !confirm("Apagar este lançamento?")) return;
    acaoEmVoo.current = true;
    const atual = ++geracao.current;
    setOcupado(true);
    try {
      await api(`/api/rh/folha/lancamentos?id=${id}`, { method: "DELETE" });
      if (geracao.current === atual) await carregar(d.competencia);
    } catch (e) {
      if (geracao.current === atual) setMsg({ t: (e as Error).message, erro: true });
    } finally { acaoEmVoo.current = false; setOcupado(false); }
  }

  if (!d) return <div className="cartao space-y-2 text-sm text-zinc-500"><p role={msg?.erro ? "alert" : "status"}>{msg?.t ?? "Carregando…"}</p>{msg?.erro && <button className="btn" onClick={() => void carregar()}>Recarregar folha</button>}</div>;
  const visiveis = d.linhas.filter((l) => l.ativo || l.status !== "ABERTA" || l.lancamentos.length);
  const total = visiveis.reduce((t, l) => t + l.liquido, 0);
  const abertas = visiveis.filter((l) => l.status === "ABERTA" && (l.salario || l.comissao || l.lancamentos.length)).length;
  const pendenciasVinculos = d.pendenciasVinculos ?? [];
  const fichasPendentes = visiveis.filter((l) => l.status === "ABERTA" && l.vinculoPendente && (l.salario || l.comissao || l.lancamentos.length));
  const vinculosIncompletos = pendenciasVinculos.length > 0 || fichasPendentes.length > 0;
  const rateioPendente = !!d.conciliacaoAssinaturas?.pendente && abertas > 0;
  const apuracaoIncompleta = vinculosIncompletos || rateioPendente;
  return (
    <fieldset disabled={ocupado} aria-busy={ocupado} aria-label="Folha de pagamento" className="min-w-0 space-y-3">
      <div className="crm-filterbar flex flex-wrap items-end gap-2">
        <div><label className="rotulo" htmlFor="competencia-folha">Competência</label><input id="competencia-folha" name="competencia" aria-label="Competência da folha" type="month" className="campo" value={d.competencia} onChange={(e) => { if (e.target.value) { setMsg(null); void carregar(e.target.value); } }} /></div>
        <button className="btn-primario" disabled={!abertas || apuracaoIncompleta} onClick={() => acao({ acao: "fechar" }, "Folha fechada: valores congelados.", `Fechar a folha de ${d.competencia.split("-").reverse().join("/")}? Os valores ficam congelados.`)}><Lock size={15} /> Fechar folha{abertas ? ` (${abertas})` : ""}</button>
        {apuracaoIncompleta
          ? <button className="btn" disabled aria-describedby={vinculosIncompletos ? "folha-vinculos-pendentes" : undefined}><Download size={15} /> Exportar CSV</button>
          : <a className="btn" href={`/api/rh/folha/csv?competencia=${d.competencia}`}><Download size={15} /> Exportar CSV</a>}
        <div className="ml-auto text-right"><p className="text-xs text-zinc-500">{apuracaoIncompleta ? "Líquido da prévia parcial" : "Líquido total"}</p><p className="text-xl font-normal text-ouro"><ContadorCrm valor={total} formatar={reais} /></p></div>
      </div>
      {msg && <p role={msg.erro ? "alert" : "status"} className={`rounded-xl p-3 text-sm ${msg.erro ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"}`}>{msg.t}</p>}
      {d.recebimentos && !d.recebimentos.completo && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{d.recebimentos.pendentes} mensalidade(s) aguardam comprovação do recebido. As comissões de assinaturas são prévias e precisam de conciliação antes do fechamento.</p>}
      {vinculosIncompletos && <section id="folha-vinculos-pendentes" role="alert" className="space-y-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
        <h2 className="font-semibold">Confira os destinatários das comissões</h2>
        <p>O total desta prévia está incompleto. Corrija os vínculos na aba Funcionários antes de fechar ou exportar a folha geral.</p>
        {pendenciasVinculos.length > 0 && <ul className="list-inside list-disc space-y-1 break-words">{pendenciasVinculos.map(p => <li key={p.barbeiroId}>{p.nome}: {reais(p.comissaoCentavos)} em comissão apurada · {MOTIVOS_VINCULO[p.motivo]}.</li>)}</ul>}
        {fichasPendentes.length > 0 && <p>Fichas de barbeiro sem vínculo confirmado: {fichasPendentes.map(l => l.nome).join(", ")}. Os valores já fechados foram preservados.</p>}
        <p>Você pode conferir e fechar individualmente uma ficha sem pendências.</p>
      </section>}
      {d.conciliacaoAssinaturas && <ResumoRateioAssinaturas dados={d.conciliacaoAssinaturas} nomes={Object.fromEntries([
        ...d.linhas.filter(l => !!l.barbeiroId).map(l => [l.barbeiroId!, l.barbeiro ?? l.nome]),
        ...pendenciasVinculos.map(p => [p.barbeiroId, p.nome]),
      ])} />}
      <LotePixFolha key={d.competencia} competencia={d.competencia} atualizacao={d} />
      {visiveis.length === 0 && <div className="cartao text-sm text-zinc-500">Ninguém na folha. Cadastre os funcionários no checklist e preencha a ficha na aba Funcionários.</div>}
      {visiveis.length > 0 && <section className="cartao space-y-4"><h2 className="font-semibold">Leitura da folha</h2><p className="text-xs text-zinc-500">Líquido por pessoa na competência. O estado de cada folha e a memória de cálculo estão nos cartões abaixo.</p><GraficoBarrasCrm rotulo="Valor líquido da folha por pessoa" formatar={reais} itens={visiveis.map(l => ({ rotulo: l.nome, valor: l.liquido, nota: STATUS[l.status] }))} /></section>}
      {visiveis.map((l) => (
        <section key={l.pessoaId} className="cartao space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <button className="flex flex-1 items-center gap-2 text-left" aria-expanded={aberto === l.pessoaId} onClick={() => setAberto(aberto === l.pessoaId ? null : l.pessoaId)}>
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
            <span>Fixo mensal <b>{reais(l.salario)}</b></span>
            <span>Comissão <b>{reais(l.comissao)}</b></span>
            <span className="text-emerald-700">+ Adicionais <b>{reais(l.adicionais)}</b></span>
            <span className="text-red-600">− Vales/descontos <b>{reais(l.descontos)}</b></span>
          </div>
          {l.mudouDepois && <p className="text-xs text-amber-700">O recálculo atual difere do retrato fechado. Os valores históricos foram preservados; confira antes de qualquer ajuste.</p>}
          {l.memoriaDisponivel === false && <p className="text-xs text-amber-700">A memória detalhada desta folha antiga não está disponível. Seus totais congelados foram preservados.</p>}
          <div className="flex flex-wrap items-center gap-2">
            {l.status === "ABERTA" && (l.salario || l.comissao || l.lancamentos.length) > 0 && (
              <button className="btn py-1.5 text-xs" disabled={l.vinculoPendente || (!!d.conciliacaoAssinaturas?.pendente && !!l.comissaoDetalhe?.assinaturas)} aria-describedby={l.vinculoPendente ? "folha-vinculos-pendentes" : undefined} onClick={() => acao({ acao: "fechar", pessoaId: l.pessoaId }, `Folha de ${l.nome} fechada.`)}><Lock size={13} /> Fechar só esta</button>
            )}
            {l.status === "FECHADA" && (
              <>
                <select aria-label={`Forma de pagamento de ${l.nome}`} className="campo w-44 py-1.5 text-sm" value={forma} onChange={(e) => setForma(e.target.value)}>{FORMAS.map((f) => <option key={f.v} value={f.v}>{f.r}</option>)}</select>
                <button className="btn" onClick={() => acao({ acao: "pagar", pessoaId: l.pessoaId, forma }, `Pagamento externo de ${l.nome} registrado nas despesas.`, `Você já realizou o pagamento de ${reais(l.liquido)} para ${l.nome}? Confirme para registrar na folha.`)}><Wallet size={15} /> Registrar pagamento realizado</button>
                <button className="btn" onClick={() => acao({ acao: "reabrir", pessoaId: l.pessoaId }, `Folha de ${l.nome} reaberta.`)}><RotateCcw size={15} /> Reabrir</button>
              </>
            )}
            {l.status === "PAGA" && l.pagoEm && <span className="text-xs text-zinc-500">Paga em {new Date(l.pagoEm).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}{l.chavePix ? ` · Pix ${l.chavePix}` : ""}</span>}
          </div>
          {aberto === l.pessoaId && (
            <div className="space-y-2 border-t border-zinc-200 pt-2 text-sm">
              {l.comissaoDetalhe && (
                <p className="text-xs text-zinc-500">
                  Comissão: {l.comissaoDetalhe.avulso.qtd} avulso(s) = {reais(l.comissaoDetalhe.avulso.comissao)}
                  {l.comissaoDetalhe.assinaturas
                    ? <> · assinaturas ({l.comissaoDetalhe.assinaturas.qtd} pelo plano, {l.comissaoDetalhe.assinaturas.creditos} créditos, {reais(l.comissaoDetalhe.assinaturas.receitaAtribuida)} atribuídos) = {reais(l.comissaoDetalhe.assinaturas.comissao)}</>
                    : <> · {l.comissaoDetalhe.plano.qtd} pelo plano = {reais(l.comissaoDetalhe.plano.comissao)}</>}
                  {l.comissaoDetalhe.produtos && <> · produtos ({reais(l.comissaoDetalhe.produtos.vendido)} vendidos) = {reais(l.comissaoDetalhe.produtos.comissao)}</>}
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
                        {l.status === "ABERTA" && !x.doCaixa && <button className="rounded p-1 text-zinc-500 hover:text-red-600" aria-label={`Apagar lançamento ${x.descricao}`} title="Apagar" onClick={() => excluir(x.id)}><Trash2 size={13} /></button>}
                      </li>
                    );
                  })}
                </ul>
              )}
              {l.status === "ABERTA" && (
                <div className="flex flex-wrap items-end gap-2">
                  <div><label className="rotulo" htmlFor={`folha-tipo-${l.pessoaId}`}>Tipo</label><select id={`folha-tipo-${l.pessoaId}`} name="tipo" className="campo py-1.5" value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value as Tipo })}>{TIPOS.map((t) => <option key={t.v} value={t.v}>{t.r}</option>)}</select></div>
                  <div><label className="rotulo" htmlFor={`folha-valor-${l.pessoaId}`}>Valor (R$)</label><input id={`folha-valor-${l.pessoaId}`} name="valor" className="campo w-28 py-1.5" inputMode="decimal" value={form.valor} onChange={(e) => setForm({ ...form, valor: e.target.value })} /></div>
                  <div className="min-w-40 flex-1"><label className="rotulo" htmlFor={`folha-descricao-${l.pessoaId}`}>Descrição</label><input id={`folha-descricao-${l.pessoaId}`} name="descricao" className="campo py-1.5" placeholder="Ex.: vale do dia 10" value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} /></div>
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
    </fieldset>
  );
}
