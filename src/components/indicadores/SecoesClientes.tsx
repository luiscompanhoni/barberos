"use client";

import { CANAIS, ORIGENS, type Dados } from "./tipos";
import { Ajuda, Barras, din, Kpi, num, pct, Secao } from "./ui";

/** Clientes, assinaturas, bar/loja e agenda. */
export function SecoesClientes({ d }: { d: Dados }) {
  const c = d.negocio.clientes;
  const a = d.assinaturas;
  const bar = d.bar;
  const ag = d.negocio.agenda;
  const totalBase = c.base.ativo + c.base.risco + c.base.perdido;

  return (
    <>
      <Secao titulo="Clientes" descricao="Quem vem, com que frequência, quem está sumindo e de onde chegam os novos.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi rotulo="Clientes novos" valor={num(c.novos)} detalhe="primeira visita no período" />
          <Kpi rotulo="Volta a cada" valor={c.frequencia.mediaDias === null ? "—" : `${num(c.frequencia.mediaDias)} dias`}
            detalhe={c.frequencia.medianaDias === null ? undefined : `mediana ${num(c.frequencia.medianaDias)} dias`}
            ajuda="Intervalo médio entre visitas de quem veio 2 ou mais vezes nos últimos 180 dias." />
          <Kpi rotulo="Novos que voltaram" valor={pct(c.retorno.taxa)} detalhe={c.retorno.base ? `${c.retorno.voltaram} de ${c.retorno.base}` : "ainda sem base"}
            ajuda="Clientes que vieram pela 1ª vez entre 45 e 90 dias atrás e voltaram em até 45 dias. Mede a fidelização." />
          <Kpi rotulo="Idade média" valor={c.idade.media === null ? "—" : `${num(c.idade.media)} anos`}
            detalhe={`${c.idade.preenchidos} de ${c.idade.atendidos} com data de nascimento`} />
        </div>
        <div className="grid gap-3 lg:grid-cols-3">
          <div className="cartao space-y-3">
            <p className="text-sm font-semibold">Base de clientes</p>
            <Barras formato={(v) => `${v} (${pct(totalBase ? v / totalBase : 0)})`} itens={[
              { rotulo: "Ativos (vieram em até 45 dias)", valor: c.base.ativo, cor: "#34c27a" },
              { rotulo: "Sumindo (45 a 90 dias)", valor: c.base.risco, cor: "#d3ab45" },
              { rotulo: "Perdidos (90+ dias)", valor: c.base.perdido, cor: "#f26b6b" },
            ]} />
          </div>
          <div className="cartao space-y-3">
            <p className="text-sm font-semibold">Frequência de quem volta</p>
            <Barras itens={Object.entries(c.frequencia.distribuicao).map(([rotulo, valor]) => ({ rotulo, valor }))} vazio="Ainda não há clientes com 2 visitas." />
          </div>
          <div className="cartao space-y-3">
            <p className="text-sm font-semibold">Faixa etária (atendidos)</p>
            <Barras itens={Object.entries(c.idade.faixas).map(([rotulo, valor]) => ({ rotulo, valor }))} vazio="Sem datas de nascimento: peça no cadastro ou no perfil do cliente." />
          </div>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="cartao space-y-3">
            <p className="text-sm font-semibold">Como os novos conheceram</p>
            <Barras itens={Object.entries(c.origens).map(([k, valor]) => ({ rotulo: ORIGENS[k] ?? k, valor }))} vazio="Nenhum cliente novo no período." />
            <Ajuda>Preencha “como conheceu” no cadastro do cliente (a recepção, o site e o bot perguntam).</Ajuda>
            <div className="border-t border-zinc-200 pt-3 text-sm">
              <p className="font-semibold">Indique e ganhe</p>
              <p className="text-zinc-500">{d.negocio.indicacoes.novas} amigo(s) indicados no período · {d.negocio.indicacoes.convertidas} já vieram</p>
              {d.negocio.indicacoes.top.length > 0 && (
                <p className="mt-1 text-xs text-zinc-500">Quem mais trouxe: {d.negocio.indicacoes.top.map((t) => `${t.nome} (${t.amigos})`).join(", ")}</p>
              )}
            </div>
          </div>
          <div className="cartao">
            <p className="mb-2 text-sm font-semibold">Quem mais gastou</p>
            {c.top.length === 0 ? <p className="text-sm text-zinc-500">Sem dados no período.</p> : (
              <ol className="divide-y divide-zinc-200 text-sm">
                {c.top.map((t, i) => (
                  <li key={t.id} className="flex items-center gap-3 py-1.5">
                    <span className="w-5 text-xs font-bold text-ouro">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate">{t.nome}</span>
                    <span className="text-xs text-zinc-500">{t.visitas} visita(s)</span>
                    <span className="w-24 text-right font-semibold">{din(t.gastoCentavos)}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </Secao>

      <Secao titulo="Assinaturas" descricao="Receita recorrente, uso do plano e quem está saindo.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi destaque rotulo="Assinantes ativos" valor={num(a.ativas)} detalhe={`${a.atrasadas} com mensalidade atrasada`} />
          <Kpi rotulo="Receita recorrente (MRR)" valor={din(a.mrrCentavos)} detalhe={`ticket ${din(a.ticketMensalCentavos)}/mês`} />
          <Kpi rotulo="Novas × canceladas" valor={`${a.novas} × ${a.canceladas}`} detalhe="no período" />
          <Kpi rotulo="Cancelamento ao mês (churn)" valor={pct(a.churnMensal, 1)} ajuda="Canceladas ÷ assinantes no início do período, levado para 30 dias. Ideal: abaixo de 5%." />
          <Kpi rotulo="Valor de um assinante (LTV)" valor={din(a.ltvCentavos)} ajuda="Quanto um assinante paga, em média, durante todo o tempo em que fica (ticket mensal ÷ churn mensal)." />
          <Kpi rotulo="Usos por assinante" valor={a.usoMedioPorAssinante === null ? "—" : num(a.usoMedioPorAssinante, 1)} detalhe={`${a.usos} atendimentos pelo plano`} />
          <Kpi rotulo="Cada corte do plano sai por" valor={din(a.valorPorUsoCentavos)} detalhe={a.tabelaPorUsoCentavos ? `tabela ${din(a.tabelaPorUsoCentavos)}` : undefined}
            ajuda="Mensalidades recebidas ÷ atendimentos feitos pelo plano. Se ficar muito abaixo da tabela, o plano está barato para o uso." />
          <Kpi rotulo="Assinantes sem usar" valor={num(a.assinantesSemUso)} detalhe="risco de cancelar" />
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="cartao space-y-3">
            <p className="text-sm font-semibold">Receita por plano</p>
            <Barras formato={din} itens={a.porPlano.map((p) => ({ rotulo: p.nome, valor: p.mrrCentavos, nota: `${p.ativas} ativos` }))} vazio="Nenhum assinante ativo." />
          </div>
          <div className="cartao space-y-3">
            <p className="text-sm font-semibold">Por que cancelaram</p>
            <Barras itens={a.motivos.map((m) => ({ rotulo: m.motivo, valor: m.qtd, cor: "#f26b6b" }))} vazio="Nenhum cancelamento no período. 🎉" />
          </div>
        </div>
      </Secao>

      <Secao titulo="Bar e loja" descricao="Consumo nas comandas fechadas: quanto cada cliente deixa além do corte.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi rotulo="Bar" valor={din(bar.barCentavos)} detalhe={`ticket ${din(bar.ticketBarCentavos)} por comanda`} />
          <Kpi rotulo="Loja" valor={din(bar.lojaCentavos)} detalhe={`ticket ${din(bar.ticketLojaCentavos)} por comanda`} />
          <Kpi rotulo="Bar por atendimento" valor={din(bar.barPorAtendimentoCentavos)} ajuda="Receita do bar ÷ atendimentos feitos. Sobe quando a equipe oferece bebida em todo corte." />
          <Kpi rotulo="Margem dos produtos" valor={pct(bar.margemBrutaPct)} detalhe={`${pct(bar.comandasComBarPct)} das comandas com bar`} />
        </div>
        <div className="cartao">
          <p className="mb-3 text-sm font-semibold">Mais vendidos</p>
          <Barras formato={din} itens={bar.topProdutos.map((p) => ({ rotulo: `${p.nome} (${p.qtd})`, valor: p.receita, nota: p.margemPct === null ? undefined : `margem ${pct(p.margemPct)}` }))}
            vazio="Nenhuma venda registrada: abra a comanda pelo atendimento na agenda." />
        </div>
      </Secao>

      <Secao titulo="Agenda" descricao="Por onde os clientes marcam e com quanta antecedência.">
        <div className="grid gap-3 lg:grid-cols-3">
          <div className="cartao space-y-3 lg:col-span-2">
            <p className="text-sm font-semibold">Canal de agendamento ({ag.criados} marcados no período)</p>
            <Barras formato={(v) => `${v} (${pct(ag.criados ? v / ag.criados : 0)})`} itens={Object.entries(ag.canais).sort((x, y) => y[1] - x[1]).map(([k, valor]) => ({ rotulo: CANAIS[k] ?? k, valor }))} />
          </div>
          <div className="grid gap-3">
            <Kpi rotulo="Antecedência média" valor={ag.antecedenciaMediaH === null ? "—" : ag.antecedenciaMediaH < 48 ? `${num(ag.antecedenciaMediaH)} h` : `${num(ag.antecedenciaMediaH / 24, 1)} dias`} detalhe="entre marcar e o horário" />
            <Kpi rotulo="Cancelados" valor={num(ag.cancelados)} detalhe={`${pct(ag.criados ? ag.cancelados / ag.criados : null)} dos marcados`} />
          </div>
        </div>
      </Secao>
    </>
  );
}
