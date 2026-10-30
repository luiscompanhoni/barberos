"use client";

import { useState } from "react";
import { reais } from "@/lib/cliente-api";
import type { GrupoReuniao, SnapshotReuniao } from "@/lib/reunioes/tipos";

export function NumerosReuniao({ snapshot: s }: { snapshot: SnapshotReuniao }) {
  const a = s.atual;
  const numeros = [["Faturamento do período", reais(a.faturamentoCentavos)], ["Atendimentos concluídos", String(a.atendimentos)],
    ["Avulsos / assinantes", `${a.avulsos} / ${a.assinantes}`], ["Ocupação", a.ocupacao === null ? "Sem base" : `${Math.round(a.ocupacao * 100)}%`],
    ["Comissões da produção", a.comissaoCentavos === null ? "Restrito ou pendente" : reais(a.comissaoCentavos)],
    ["Margem estimada antes de taxas", a.margemCentavos === null ? "Restrita ou pendente" : reais(a.margemCentavos)]];
  return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{numeros.map(([nome, valor]) => <div key={nome} className="cartao"><p className="text-xs text-zinc-500">{nome}</p><p className="mt-1 text-2xl font-semibold text-ouro">{valor}</p></div>)}</div>;
}

export function TabelaGrupos({ titulo, grupos }: { titulo: string; grupos: GrupoReuniao[] }) {
  const [filtro, setFiltro] = useState("");
  const lista = grupos.filter((g) => !filtro || g.id === filtro);
  return <section className="cartao space-y-3"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">{titulo}</h3>
    <label className="text-xs text-zinc-500">Filtrar {titulo.toLocaleLowerCase("pt-BR")}<select className="campo mt-1" value={filtro} onChange={(e) => setFiltro(e.target.value)}><option value="">Todos</option>{grupos.map((g) => <option value={g.id} key={g.id}>{g.nome}</option>)}</select></label></div>
    <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-zinc-200 text-xs text-zinc-500"><th className="p-2">Nome</th><th className="p-2">Serviços</th><th className="p-2">Vendas líquidas</th><th className="p-2">Assinaturas atribuídas</th><th className="p-2">Comissões</th><th className="p-2">Margem estimada</th></tr></thead><tbody>{lista.map((g) => <tr key={g.id} className="border-b border-zinc-100"><td className="p-2">{g.nome}</td><td className="p-2">{g.atendimentos}<span className="block text-xs text-zinc-500">{g.avulsos} avulsos · {g.assinantes} plano</span></td><td className="p-2">{reais(g.vendasCentavos)}</td><td className="p-2">{reais(g.receitaAssinaturasCentavos)}</td><td className="p-2">{g.comissaoCentavos === null ? "—" : reais(g.comissaoCentavos)}</td><td className="p-2">{g.margemCentavos === null ? "Pendente/restrita" : reais(g.margemCentavos)}</td></tr>)}</tbody></table></div>
    {!lista.length && <p className="text-sm text-zinc-500">Sem dados neste período.</p>}</section>;
}

export function RelatorioReuniao({ snapshot: s }: { snapshot: SnapshotReuniao }) {
  return <div className="space-y-4"><NumerosReuniao snapshot={s} />
    {s.diaria.length > 0 && <section className="cartao"><h3 className="font-semibold">Preparação da reunião diária</h3>{s.diaria.map((d) => <div key={d.barbeiroId} className="mt-3 border-b border-zinc-100 pb-3 text-sm"><b>{d.nome}</b><p>{d.clientes} clientes · {d.avulsos} avulsos · {d.assinantes} pelo plano · receita prevista {reais(d.receitaPrevistaCentavos)}{d.comissaoAvulsaCentavos === null ? "" : ` · comissão avulsa ${reais(d.comissaoAvulsaCentavos)}`}</p><p className="text-xs text-zinc-500">{d.cenarios.length} alternativa(s) de serviços para encaixe. Assinaturas calculadas separadamente.</p></div>)}</section>}
    <p className="text-sm text-zinc-500">Acumulado de {s.mes.inicio} a {s.mes.fim}: <b>{reais(s.mes.faturamentoCentavos)}</b> · {s.mes.atendimentos} atendimentos. Intervalo anterior: {reais(s.anterior.faturamentoCentavos)}.</p>
    <TabelaGrupos titulo="Barbeiros" grupos={s.barbeiros} /><TabelaGrupos titulo="Cadeiras" grupos={s.cadeiras} /><TabelaGrupos titulo="Serviços e produtos" grupos={s.servicos} />
    <section className="grid gap-3 md:grid-cols-2">{s.leituras.map((l) => <article className="cartao" key={l.titulo}><p className={`text-xs uppercase ${l.tipo === "bom" ? "text-emerald-600" : "text-amber-600"}`}>{l.tipo === "bom" ? "Acerto" : l.tipo === "atencao" ? "Ponto de atenção" : "Oportunidade"}</p><h3 className="mt-1 font-semibold">{l.titulo}</h3><p className="mt-2 text-sm text-zinc-500">{l.detalhe}</p><p className="mt-2 text-sm">{l.acao}</p></article>)}</section>
    {s.qualidade.length > 0 && <section className="cartao"><h3 className="font-semibold">Avaliações publicadas dos clientes</h3><div className="mt-2 flex flex-wrap gap-4">{s.qualidade.map((q) => <p key={q.barbeiroId} className="text-sm">{q.nome}: <b>{q.media === null ? "Em formação" : `${q.media.toFixed(1)}/5`}</b> · {q.quantidade} avaliações agregadas</p>)}</div></section>}
    {s.desempenho.length > 0 && <section className="cartao"><h3 className="font-semibold">Presença, checklist e liderança</h3>{s.desempenho.map((d) => <p key={d.barbeiroId} className="mt-2 text-sm">{d.nome} · Presença {d.presencaPercentual === null ? "em formação" : `${d.presencaPercentual}%`} · Checklist {d.checklistValidados}/{d.checklistTotal} · Líder {d.mediaLider === null ? "sem nota" : `${d.mediaLider.toFixed(1)}/5`}</p>)}</section>}
    {s.financeiro && <section className="cartao"><h3 className="font-semibold">Resultado de caixa · {s.financeiro.mes}</h3><p className="mt-2 text-sm">Recebimentos líquidos: {reais(s.financeiro.receitasCentavos)} · Despesas pagas: {reais(s.financeiro.despesasCentavos)} · Resultado: <b>{reais(s.financeiro.resultadoCaixaCentavos)}</b></p><p className="mt-1 text-xs text-zinc-500">Mesmo critério do financeiro mensal. O resultado depende dos lançamentos registrados; não representa lucro contábil nem o saldo de uma cadeira.</p></section>}
    <details className="cartao"><summary className="cursor-pointer font-semibold">Origem e limites dos cálculos</summary><ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-zinc-500">{s.avisos.map((a) => <li key={a}>{a}</li>)}</ul><p className="mt-3 text-xs">Retrato gerado em {new Date(s.geradoEm).toLocaleString("pt-BR", { timeZone: s.fuso })}. Os números desta reunião são preservados.</p></details>
  </div>;
}
