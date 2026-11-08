"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { api, reais } from "@/lib/cliente-api";
import { GraficoBarrasCrm } from "@/components/visual/GraficoBarrasCrm";
import { ContadorCrm } from "@/components/visual/ContadorCrm";

type Soma = { qtd: number; base: number; comissao: number; adicional?: number };
type Atend = { id: string; inicio: string; cliente: string; servico: string; modalidade: "AVULSO" | "PLANO"; base: number; regra: string; comissao: number };
type Assinaturas = { qtd: number; creditos: number; receitaAtribuida: number; percentualBaseBps?: number; adicionalBps?: number; comissaoBase?: number; adicionalCentavos?: number; comissao: number };
type Produtos = { vendido: number; comissao: number; categorias: { categoria: "BAR" | "LOJA"; vendido: number; percentualBps: number; comissao: number }[] };
type Folha = { salario: number; bonus: number; descontos: number; totalAPagar: number; status: "ABERTA" | "FECHADA" | "PAGA" };
type Linha = {
  barbeiroId: string; nome: string; avulso: Soma; plano: Soma; assinaturas: Assinaturas | null; produtos: Produtos | null;
  folha: Folha | null; total: number; semRegra: number; atendimentos: Atend[];
  fonte?: "RETRATO_FECHADO" | "APURACAO_ATUAL"; memoriaDisponivel?: boolean; recalculoAtual?: { total: number };
};
type Dados = {
  inicio: string; fim: string; competencia: string | null; total: number; barbeiros: Linha[];
  recebimentos?: { completo: boolean; pendentes: number }; regrasLegadas?: boolean;
  assinaturas: { recebidoCentavos: number; estornosCentavos: number; distribuivelCentavos: number; creditosTotal: number; valorCreditoCentavos: number; percentualBaseBps: number } | null;
};
const pct = (bps: number) => `${(bps / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
const pts = (bps: number) => `${bps >= 0 ? "+" : "−"}${(Math.abs(bps) / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} pts`;
const dataHora = (d: string) => new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
const FOLHA = { ABERTA: "folha aberta", FECHADA: "folha fechada", PAGA: "folha paga" } as const;

function Item({ rotulo, valor, forte, sub }: { rotulo: string; valor: string; forte?: boolean; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-zinc-200 py-1">
      <span className="text-zinc-500">{rotulo}{sub && <span className="ml-1 text-xs">({sub})</span>}</span>
      <span className={forte ? "font-bold" : ""}>{valor}</span>
    </div>
  );
}

/** Relatorio de comissoes do periodo por barbeiro: assinaturas, avulsos, produtos, adicionais e (mes inteiro) folha. */
export function ComissoesRelatorio() {
  const [d, setD] = useState<Dados | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  const [erro, setErro] = useState("");

  const carregar = useCallback((inicio?: string, fim?: string) => {
    api<Dados>(`/api/rh/comissoes/relatorio${inicio && fim ? `?inicio=${inicio}&fim=${fim}` : ""}`).then((r) => { setErro(""); setD(r); }).catch((e) => setErro(e.message));
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const a = d?.assinaturas;
  return (
    <div className="space-y-3">
      <div className="crm-filterbar flex flex-wrap items-end gap-2">
        <div><label className="rotulo">De</label><input aria-label="Data inicial das comissões" type="date" className="campo" value={d?.inicio ?? ""} onChange={(e) => d && carregar(e.target.value, d.fim)} /></div>
        <div><label className="rotulo">Até</label><input aria-label="Data final das comissões" type="date" className="campo" value={d?.fim ?? ""} onChange={(e) => d && carregar(d.inicio, e.target.value)} /></div>
        {d && <p className="ml-auto text-sm">Comissões do período: <b className="text-lg font-normal text-ouro"><ContadorCrm valor={d.total} formatar={reais} /></b></p>}
      </div>
      {erro && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{erro}</p>}
      {d?.recebimentos && !d.recebimentos.completo && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{d.recebimentos.pendentes} mensalidade(s) aguardam comprovação do recebido. O cálculo aberto é provisório.</p>}
      {d?.regrasLegadas && <p className="text-xs text-amber-800">Parte das regras vem do cadastro legado observado. A vigência histórica ainda precisa de conferência; folhas fechadas mantêm seu retrato.</p>}
      {a && (
        <div className="rounded-xl bg-zinc-100 p-3 text-sm">
          <b>Receita de Assinaturas</b> {reais(a.recebidoCentavos)}
          {a.estornosCentavos > 0 && <> − estornos {reais(a.estornosCentavos)}</>} = <b>Receita Distribuível</b> {reais(a.distribuivelCentavos)},
          dividida por <b>{a.creditosTotal} Créditos de Atendimento</b>{a.creditosTotal ? <> ({reais(a.valorCreditoCentavos)} por crédito)</> : null}.
          Percentual base do recálculo: <b>{pct(a.percentualBaseBps)}</b>. Os valores de folhas fechadas são mostrados a partir do retrato histórico.
        </div>
      )}
      {d && !d.competencia && <p className="text-xs text-zinc-500">Escolha um mês inteiro (dia 1 ao último dia) para ver bônus, descontos e o total a pagar de cada um.</p>}
      {d && d.barbeiros.length > 0 && <section className="cartao space-y-4"><h2 className="font-semibold">Comissões por profissional</h2><p className="text-xs text-zinc-500">Comissões apuradas no período selecionado. Salário, bônus e descontos permanecem na folha.</p><GraficoBarrasCrm rotulo="Comissões do período por profissional" formatar={reais} itens={d.barbeiros.map(b => ({ rotulo: b.nome, valor: b.total }))} /></section>}
      {d && d.barbeiros.length === 0 && <div className="cartao text-sm text-zinc-500">Nenhum atendimento concluído no período.</div>}
      {d?.barbeiros.map((b) => (
        <section key={b.barbeiroId} className="cartao space-y-2">
          <button className="flex w-full flex-wrap items-center gap-3 text-left" aria-expanded={aberto === b.barbeiroId} onClick={() => setAberto(aberto === b.barbeiroId ? null : b.barbeiroId)}>
            {aberto === b.barbeiroId ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            <span className="flex-1 font-semibold">{b.nome}</span>
            {a
              ? <span className="text-xs text-zinc-500">Assinaturas: {b.assinaturas?.creditos ?? 0} créditos · <b>{reais(b.assinaturas?.comissao ?? 0)}</b></span>
              : <span className="text-xs text-zinc-500">Plano: {b.plano.qtd} · <b>{reais(b.plano.comissao)}</b></span>}
            <span className="text-xs text-zinc-500">Avulsos: {b.avulso.qtd} · <b>{reais(b.avulso.comissao)}</b></span>
            {b.produtos && <span className="text-xs text-zinc-500">Produtos: <b>{reais(b.produtos.comissao)}</b></span>}
            <span className="w-28 text-right text-lg font-black text-ouro" title="Total de comissões">{reais(b.total)}</span>
          </button>
          {b.semRegra > 0 && <p className="text-xs text-amber-700">{b.semRegra} atendimento(s) de serviço sem regra salva (não geraram comissão). Configure em “Regras de comissão”.</p>}
          {b.fonte === "RETRATO_FECHADO" && <p className="text-xs text-zinc-500">Valores congelados da folha. {b.recalculoAtual && b.recalculoAtual.total !== b.total ? `Recálculo atual de comissão: ${reais(b.recalculoAtual.total)}. O histórico foi preservado.` : ""}{b.memoriaDisponivel === false ? " Memória detalhada antiga indisponível." : ""}</p>}
          {aberto === b.barbeiroId && (
            <div className="space-y-3">
              <div className="max-w-md text-sm">
                {a && b.assinaturas && (
                  <>
                    <Item rotulo="Receita de Assinaturas (de todos)" valor={reais(a.recebidoCentavos)} />
                    <Item rotulo="Créditos de Atendimento" valor={`${b.assinaturas.creditos} de ${a.creditosTotal}`} sub={`${b.assinaturas.qtd} pelo plano`} />
                    <Item rotulo="Receita atribuída" valor={reais(b.assinaturas.receitaAtribuida)} />
                    {b.assinaturas.percentualBaseBps !== undefined && <Item rotulo="Percentual base" valor={pct(b.assinaturas.percentualBaseBps)} sub={b.assinaturas.comissaoBase === undefined ? undefined : reais(b.assinaturas.comissaoBase)} />}
                    {b.assinaturas.adicionalBps !== undefined && b.assinaturas.adicionalBps !== 0 && <Item rotulo="Adicional diferenciado" valor={pts(b.assinaturas.adicionalBps)} sub={b.assinaturas.adicionalCentavos === undefined ? undefined : reais(b.assinaturas.adicionalCentavos)} />}
                    <Item rotulo="Comissão de assinaturas" valor={reais(b.assinaturas.comissao)} forte />
                  </>
                )}
                {!a && <Item rotulo="Comissão pelo plano" valor={reais(b.plano.comissao)} sub={`${b.plano.qtd} atendimento(s)`} forte />}
                <Item rotulo="Comissão de avulsos" valor={reais(b.avulso.comissao)} sub={`${b.avulso.qtd} sobre ${reais(b.avulso.base)} cobrados${b.avulso.adicional ? `, adicional ${reais(b.avulso.adicional)}` : ""}`} forte />
                {b.produtos && <Item rotulo="Comissão de produtos" valor={reais(b.produtos.comissao)} sub={`${reais(b.produtos.vendido)} vendidos`} forte />}
                <Item rotulo="Total de comissões" valor={reais(b.total)} forte />
                {b.folha && (
                  <>
                    {b.folha.salario > 0 && <Item rotulo="Salário" valor={reais(b.folha.salario)} />}
                    {b.folha.bonus > 0 && <Item rotulo="Bônus e adicionais" valor={`+ ${reais(b.folha.bonus)}`} />}
                    {b.folha.descontos > 0 && <Item rotulo="Vales e descontos" valor={`− ${reais(b.folha.descontos)}`} />}
                    <Item rotulo="Total a pagar" valor={reais(b.folha.totalAPagar)} sub={FOLHA[b.folha.status]} forte />
                  </>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-xs">
                  <thead><tr className="text-left text-zinc-500"><th className="py-1">Data</th><th>Cliente</th><th>Serviço</th><th>Tipo</th><th className="pr-4 text-right">Base</th><th>Regra</th><th className="text-right">Comissão</th></tr></thead>
                  <tbody>
                    {b.atendimentos.map((x) => (
                      <tr key={x.id} className="border-t border-zinc-200">
                        <td className="py-1">{dataHora(x.inicio)}</td>
                        <td>{x.cliente}</td>
                        <td>{x.servico}</td>
                        <td><span className={x.modalidade === "PLANO" ? "selo-ouro" : "text-zinc-500"}>{x.modalidade === "PLANO" ? "Plano" : "Avulso"}</span></td>
                        <td className="pr-4 text-right">{reais(x.base)}</td>
                        <td className="text-zinc-500">{x.regra}</td>
                        <td className="text-right font-semibold">{reais(x.comissao)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
