"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { api } from "@/lib/cliente-api";
import { DIAS_CURTOS, SeletorPeriodo, type DadosBarbeiro } from "./tipos";
import { Barras, Colunas, din, Kpi, num, pct, Secao } from "./ui";

const vs = (a: number | null, b: number | null) => (a !== null && b ? (a - b) / b : null);

/** Detalhe de um barbeiro (dono ve todos; barbeiro ve o proprio). */
export function BarbeiroTela({ id, periodoInicial, voltar }: { id: string; periodoInicial: string; voltar: string | null }) {
  const router = useRouter();
  const [periodo, setPeriodo] = useState(periodoInicial);
  const [d, setD] = useState<DadosBarbeiro | null>(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    let vivo = true;
    api<DadosBarbeiro>(`/api/indicadores/barbeiro/${id}?periodo=${periodo}`).then((r) => vivo && setD(r)).catch((e) => vivo && setErro(e.message));
    return () => { vivo = false; };
  }, [id, periodo]);

  function trocar(p: string) {
    setPeriodo(p);
    router.replace(`?periodo=${p}`, { scroll: false });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div className="flex flex-wrap items-end gap-3">
        {voltar && <Link href={`${voltar}?periodo=${periodo}#ocupacao`} className="btn h-9 w-9 p-0" aria-label="Voltar"><ArrowLeft size={16} /></Link>}
        <div>
          <p className="eyebrow">Barbeiro</p>
          <h1 className="titulo-marca flex items-center gap-2 text-3xl">
            {d && <span className="inline-block h-3 w-3 rounded-full" style={{ background: d.barbeiro.cor }} />}
            {d?.barbeiro.nome ?? "…"}
          </h1>
        </div>
        <div className="ml-auto"><SeletorPeriodo valor={periodo} onChange={trocar} /></div>
      </div>
      {erro && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{erro}</p>}
      {d && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi destaque rotulo="Ocupação" valor={pct(d.ocupacao.taxa)} variacao={vs(d.ocupacao.taxa, d.ocupacaoEquipe.taxa)}
              detalhe={`equipe ${pct(d.ocupacaoEquipe.taxa)}`} ajuda="A seta compara com a média da equipe no mesmo período." />
            <Kpi rotulo="Atendimentos" valor={num(d.atendimentos)} variacao={vs(d.atendimentos, d.mediaEquipeAtendimentos)} detalhe={`média da equipe ${d.mediaEquipeAtendimentos}`} />
            <Kpi rotulo="Serviços avulsos" valor={din(d.receitaServicosCentavos)} detalhe={`ticket ${din(d.ticketAvulsoCentavos)}`} />
            <Kpi rotulo="Pelo plano" valor={num(d.peloPlano)} detalhe={`${pct(d.atendimentos ? d.peloPlano / d.atendimentos : null)} dos atendimentos`} />
            <Kpi rotulo="Clientes atendidos" valor={num(d.clientesUnicos)} detalhe={`${d.clientesNovos} novos com ele`} />
            <Kpi rotulo="Clientes fiéis" valor={pct(d.fidelidade.taxa)} detalhe={`${d.fidelidade.voltaram} de ${d.fidelidade.clientes} voltaram com ele`}
              ajuda="Dos clientes que ele atendeu nos últimos 180 dias, quantos vieram 2 ou mais vezes com ele." />
            <Kpi rotulo="Faltas" valor={pct(d.taxaFalta, 1)} inverso detalhe={`${d.faltas} no período`} />
            <Kpi rotulo="Produtos vendidos" valor={din(d.vendasProdutosCentavos)} detalhe="lançados por ele na comanda" />
          </div>

          <Secao titulo="Ocupação" descricao="Quanto da agenda aberta dele virou atendimento.">
            <div className="grid gap-3 lg:grid-cols-[1fr_2fr]">
              <div className="cartao">
                <p className="mb-3 text-sm font-semibold">Por dia da semana</p>
                <Colunas taxa formato={(v) => pct(v)} itens={d.porDiaSemana.map((x) => ({ rotulo: DIAS_CURTOS[x.diaSemana], valor: x.taxa }))} />
              </div>
              <div className="cartao">
                <p className="mb-3 text-sm font-semibold">Dia a dia</p>
                <Colunas taxa formato={(v) => pct(v)} itens={d.porDia.map((x) => ({ rotulo: x.data.slice(8), dica: x.data.split("-").reverse().join("/"), valor: x.taxa }))} />
              </div>
            </div>
          </Secao>

          <div className="grid gap-3 lg:grid-cols-3">
            <div className="cartao">
              <p className="mb-3 text-sm font-semibold">Horários mais procurados</p>
              <Colunas itens={d.porHora.map((h) => ({ rotulo: `${h.hora}h`, valor: h.qtd }))} formato={(v) => `${v} atendimentos`} />
            </div>
            <div className="cartao space-y-3">
              <p className="text-sm font-semibold">Serviços</p>
              <Barras itens={d.servicos.map((s) => ({ rotulo: s.nome, valor: s.qtd }))} />
            </div>
            <div className="cartao space-y-3">
              <p className="text-sm font-semibold">Produtos que ele vendeu</p>
              <Barras formato={din} itens={d.produtos.map((p) => ({ rotulo: `${p.nome} (${p.qtd})`, valor: p.receita }))} vazio="Nenhum produto lançado por ele." />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
