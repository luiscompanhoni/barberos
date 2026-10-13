"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, Lightbulb } from "lucide-react";
import { api } from "@/lib/cliente-api";
import { SecoesClientes } from "./SecoesClientes";
import { DIAS_CURTOS, SeletorPeriodo, type Dados } from "./tipos";
import { Barras, Colunas, din, Kpi, num, pct, Secao } from "./ui";

const variacao = (a: number, b: number) => (b ? (a - b) / b : null);

/** Visao do negocio inteiro (so o dono). */
export function IndicadoresTela() {
  const [periodo, setPeriodo] = useState("30d");
  const [d, setD] = useState<Dados | null>(null);
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let vivo = true;
    api<Dados>(`/api/indicadores?periodo=${periodo}`)
      .then((r) => { if (vivo) { setD(r); setErro(""); } })
      .catch((e) => vivo && setErro(e.message))
      .finally(() => vivo && setCarregando(false));
    return () => { vivo = false; };
  }, [periodo]);

  const trocar = (p: string) => { setCarregando(true); setPeriodo(p); };

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <p className="eyebrow">Visão do negócio</p>
          <h1 className="titulo-marca text-3xl">Indicadores</h1>
        </div>
        <div className="ml-auto"><SeletorPeriodo valor={periodo} onChange={trocar} /></div>
      </div>
      {erro && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{erro}</p>}
      {!d ? <p className="text-sm text-zinc-500">Calculando...</p> : (
        <div className={`space-y-10 transition-opacity ${carregando ? "opacity-50" : ""}`}>
          <Leituras d={d} />
          <Resumo d={d} />
          <Equipe d={d} />
          <SecoesClientes d={d} />
        </div>
      )}
    </div>
  );
}

function Leituras({ d }: { d: Dados }) {
  if (!d.leituras.length) return null;
  return (
    <Secao titulo="O que os números dizem" descricao="Leituras automáticas do período, com o próximo passo.">
      <div className="grid gap-3 md:grid-cols-2">
        {d.leituras.map((l) => {
          const Icone = l.tipo === "atencao" ? AlertTriangle : l.tipo === "bom" ? CheckCircle2 : Lightbulb;
          return (
            <div key={l.titulo} className={`cartao flex gap-3 ${l.tipo === "atencao" ? "border-amber-300" : ""}`}>
              <Icone size={18} className={`mt-0.5 shrink-0 ${l.tipo === "atencao" ? "text-amber-700" : "text-ouro"}`} />
              <div className="min-w-0 text-sm">
                <p className="font-bold">{l.titulo}</p>
                <p className="mt-0.5 text-zinc-500">{l.texto}</p>
                {l.acao && <Link href={l.acao.href} className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-ouro">{l.acao.rotulo} <ArrowRight size={12} /></Link>}
              </div>
            </div>
          );
        })}
      </div>
    </Secao>
  );
}

function Resumo({ d }: { d: Dados }) {
  const { atual: a, anterior: b } = d.negocio;
  const r = a.receita;
  return (
    <Secao titulo="Resumo" descricao={`${d.periodo.rotulo}, comparado com o mesmo número de dias antes.`}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi destaque rotulo="Faturamento total" valor={din(r.total)} variacao={variacao(r.total, b.receita.total)}
          ajuda="Serviços avulsos concluídos + mensalidades pagas + bar + loja + itens avulsos das comandas." />
        <Kpi rotulo="Atendimentos" valor={num(a.atendimentos)} variacao={variacao(a.atendimentos, b.atendimentos)} detalhe={`${a.peloPlano} pelo plano`} />
        <Kpi rotulo="Clientes atendidos" valor={num(a.clientesUnicos)} variacao={variacao(a.clientesUnicos, b.clientesUnicos)} detalhe={`${d.negocio.clientes.novos} novos`} />
        <Kpi rotulo="Gasto médio por cliente" valor={din(a.gastoPorCliente)} variacao={a.gastoPorCliente && b.gastoPorCliente ? variacao(a.gastoPorCliente, b.gastoPorCliente) : null}
          ajuda="Faturamento total dividido pelos clientes atendidos no período (ticket por cabeça)." />
        <Kpi rotulo="Ticket médio do serviço avulso" valor={din(a.ticketAvulso)} variacao={a.ticketAvulso && b.ticketAvulso ? variacao(a.ticketAvulso, b.ticketAvulso) : null} />
        <Kpi rotulo="Ocupação da agenda" valor={pct(d.equipe.total.taxa)} detalhe={`${num(Math.round((d.equipe.total.capacidadeMin - d.equipe.total.ocupadoMin) / 60))} h livres`}
          ajuda="Minutos com cliente na cadeira ÷ minutos de agenda aberta (expediente menos horários fechados). Falta não conta." />
        <Kpi rotulo="Taxa de faltas" valor={pct(d.negocio.agenda.taxaFalta, 1)} inverso variacao={variacao(a.faltas, b.faltas)} detalhe={`${a.faltas} faltas`} />
        <Kpi rotulo="Receita recorrente (MRR)" valor={din(d.assinaturas.mrrCentavos)} detalhe={`${d.assinaturas.ativas} assinantes`} />
      </div>
      <div className="cartao">
        <p className="mb-3 text-sm font-semibold">De onde veio o dinheiro</p>
        <Barras formato={din} itens={[
          { rotulo: "Serviços avulsos", valor: r.servicos },
          { rotulo: "Assinaturas (mensalidades pagas)", valor: r.assinaturas },
          { rotulo: "Bar", valor: r.bar },
          { rotulo: "Loja (produtos)", valor: r.loja },
          { rotulo: "Outros itens de comanda", valor: r.outros },
        ].filter((x) => x.valor > 0)} />
      </div>
    </Secao>
  );
}

function Equipe({ d }: { d: Dados }) {
  const e = d.equipe;
  return (
    <Secao id="ocupacao" titulo="Ocupação e equipe" descricao="Quanto da agenda aberta virou atendimento, por barbeiro e por dia.">
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="cartao">
          <p className="mb-3 text-sm font-semibold">Por dia da semana</p>
          <Colunas taxa formato={(v) => pct(v)} itens={e.porDiaSemana.map((x) => ({ rotulo: DIAS_CURTOS[x.diaSemana], valor: x.taxa }))} />
        </div>
        <div className="cartao">
          <p className="mb-3 text-sm font-semibold">Dia a dia</p>
          <Colunas taxa formato={(v) => pct(v)} itens={e.porDia.map((x) => ({ rotulo: x.data.slice(8), dica: x.data.split("-").reverse().join("/"), valor: x.taxa }))} />
        </div>
      </div>
      <div className="cartao overflow-x-auto p-0">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-[11px] text-zinc-500 uppercase">
              <th className="px-4 py-2.5">Barbeiro</th><th className="px-2">Ocupação</th><th className="px-2">Atend.</th><th className="px-2">Clientes</th>
              <th className="px-2">Pelo plano</th><th className="px-2">Serviços</th><th className="px-2">Ticket</th><th className="px-2">Produtos</th><th className="px-2">Faltas</th><th />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200">
            {e.barbeiros.map((b) => (
              <tr key={b.id} className="hover:bg-zinc-50">
                <td className="px-4 py-2.5 font-semibold"><span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ background: b.cor }} />{b.nome}</td>
                <td className="px-2">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-16 rounded-full bg-zinc-200"><div className="h-1.5 rounded-full bg-ouro" style={{ width: `${(b.taxa ?? 0) * 100}%` }} /></div>
                    {pct(b.taxa)}
                  </div>
                </td>
                <td className="px-2">{b.atendimentos}</td>
                <td className="px-2">{b.clientes}</td>
                <td className="px-2">{pct(b.peloPlanoPct)}</td>
                <td className="px-2">{din(b.receitaServicosCentavos)}</td>
                <td className="px-2">{din(b.ticketAvulsoCentavos)}</td>
                <td className="px-2">{din(b.vendasProdutosCentavos)}</td>
                <td className={`px-2 ${b.taxaFalta && b.taxaFalta > 0.07 ? "text-red-600" : ""}`}>{pct(b.taxaFalta)}</td>
                <td className="px-3 text-right">
                  <Link href={`/indicadores/barbeiro/${b.id}?periodo=${d.periodo.chave}`} className="inline-flex items-center gap-1 text-xs font-semibold whitespace-nowrap text-ouro">Ver detalhes <ArrowRight size={12} /></Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Secao>
  );
}
