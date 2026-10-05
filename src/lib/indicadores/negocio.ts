/**
 * Indicadores do negocio num periodo: dinheiro, atendimentos, clientes.
 * Receita de servico vem da agenda (atendimentos concluidos); bar/loja das comandas fechadas;
 * assinaturas das mensalidades pagas. Assim nada e contado duas vezes.
 */
import { configuracao } from "@/lib/agenda/carregar";
import { dataLocal } from "@/lib/agenda/tempo";
import { vendasDoPeriodo } from "@/lib/comandas/relatorio";
import { db } from "@/lib/db";
import {
  FAIXAS_ETARIAS, FAIXAS_FREQUENCIA, faixaEtaria, faixaFrequencia, idade, intervalosPorCliente, media, mediana,
  situacaoPelaUltimaVisita, taxaDeRetorno,
} from "./calculos";
import type { Periodo } from "./periodo";

const DIA = 86_400_000;
const intervalo = (de: number, ate: number) => ({ gte: new Date(de), lt: new Date(ate) });

/** Faturamento e volume de um intervalo (usado no periodo e no anterior, para comparar). */
async function numerosDoIntervalo(de: number, ate: number) {
  const [ags, assin, vendas] = await Promise.all([
    db.agendamento.findMany({ where: { inicio: intervalo(de, ate), status: { in: ["CONCLUIDO", "FALTOU"] } }, select: { clienteId: true, status: true, precoCentavos: true, assinaturaId: true } }),
    db.cobranca.aggregate({ where: { status: "PAGA", pagaEm: intervalo(de, ate) }, _sum: { valorCentavos: true } }),
    vendasDoPeriodo(new Date(de), new Date(ate)),
  ]);
  const feitos = ags.filter((a) => a.status === "CONCLUIDO");
  const avulsos = feitos.filter((a) => !a.assinaturaId);
  const receita = {
    servicos: avulsos.reduce((s, a) => s + a.precoCentavos, 0),
    assinaturas: assin._sum.valorCentavos ?? 0,
    bar: vendas.porTipo.bar,
    loja: vendas.porTipo.loja,
    outros: vendas.porTipo.outros,
  };
  const total = receita.servicos + receita.assinaturas + receita.bar + receita.loja + receita.outros;
  const clientes = new Set(feitos.map((a) => a.clienteId)).size;
  return {
    receita: { ...receita, total },
    atendimentos: feitos.length,
    peloPlano: feitos.length - avulsos.length,
    avulsos: avulsos.length,
    faltas: ags.length - feitos.length,
    clientesUnicos: clientes,
    ticketAvulso: avulsos.length ? Math.round(receita.servicos / avulsos.length) : null,
    gastoPorCliente: clientes ? Math.round(total / clientes) : null,
    comandas: vendas.comandas,
  };
}

export async function indicadoresDoNegocio(p: Periodo, agora = Date.now()) {
  const cfg = await configuracao();
  const hoje = dataLocal(agora, cfg.fuso);
  const [atual, anterior] = await Promise.all([numerosDoIntervalo(p.de, p.ate), numerosDoIntervalo(p.anterior.de, p.anterior.ate)]);

  // ---- agendamentos criados no periodo: canal e antecedencia
  const criados = await db.agendamento.findMany({ where: { criadoEm: intervalo(p.de, p.ate) }, select: { origem: true, criadoEm: true, inicio: true, status: true } });
  const canais: Record<string, number> = {};
  for (const c of criados) canais[c.origem] = (canais[c.origem] ?? 0) + 1;
  const antecedencias = criados.map((c) => (+c.inicio - +c.criadoEm) / 3_600_000).filter((h) => h >= 0);
  const cancelados = criados.filter((c) => c.status === "CANCELADO").length;

  // ---- clientes novos no periodo (1a visita concluida) e de onde vieram
  const primeiras = await db.agendamento.groupBy({ by: ["clienteId"], where: { status: "CONCLUIDO" }, _min: { inicio: true } });
  const novosIds = primeiras.filter((x) => +x._min.inicio! >= p.de && +x._min.inicio! < p.ate).map((x) => x.clienteId);
  const novos = await db.cliente.findMany({ where: { id: { in: novosIds } }, select: { origem: true } });
  const origens: Record<string, number> = {};
  for (const n of novos) origens[n.origem ?? "NAO_INFORMADO"] = (origens[n.origem ?? "NAO_INFORMADO"] ?? 0) + 1;

  // ---- frequencia (ultimos 180 dias ate o fim do periodo)
  const fim = Math.min(p.ate, agora);
  const visitas180 = await db.agendamento.findMany({ where: { status: "CONCLUIDO", inicio: intervalo(fim - 180 * DIA, fim) }, select: { clienteId: true, inicio: true } });
  const porCliente = new Map<string, number[]>();
  for (const v of visitas180) porCliente.set(v.clienteId, [...(porCliente.get(v.clienteId) ?? []), +v.inicio]);
  const intervalos = [...intervalosPorCliente(porCliente).values()];
  const distFreq = Object.fromEntries(FAIXAS_FREQUENCIA.map((f) => [f, 0])) as Record<string, number>;
  for (const d of intervalos) distFreq[faixaFrequencia(d)]++;

  // ---- retorno de novos: 1a visita entre 90 e 45 dias atras; voltou em ate 45 dias?
  const coorte = primeiras.filter((x) => +x._min.inicio! >= agora - 90 * DIA && +x._min.inicio! < agora - 45 * DIA);
  const segundas = coorte.length
    ? await db.agendamento.findMany({ where: { status: "CONCLUIDO", clienteId: { in: coorte.map((c) => c.clienteId) } }, select: { clienteId: true, inicio: true }, orderBy: { inicio: "asc" } })
    : [];
  const retorno = taxaDeRetorno(coorte.map((c) => {
    const vs = segundas.filter((s) => s.clienteId === c.clienteId).map((s) => +s.inicio);
    return [+c._min.inicio!, vs[1] ?? null] as [number, number | null];
  }));

  // ---- base de clientes pela ultima visita
  const ultimas = await db.agendamento.groupBy({ by: ["clienteId"], where: { status: "CONCLUIDO", inicio: { lt: new Date(agora) } }, _max: { inicio: true } });
  const base = { ativo: 0, risco: 0, perdido: 0 };
  for (const u of ultimas) base[situacaoPelaUltimaVisita(+u._max.inicio!, agora)]++;

  // ---- idade dos clientes atendidos no periodo
  const atendidosIds = [...new Set((await db.agendamento.findMany({ where: { status: "CONCLUIDO", inicio: intervalo(p.de, p.ate) }, select: { clienteId: true } })).map((a) => a.clienteId))];
  const nascimentos = await db.cliente.findMany({ where: { id: { in: atendidosIds }, dataNascimento: { not: null } }, select: { dataNascimento: true } });
  const idades = nascimentos.map((n) => idade(n.dataNascimento!.toISOString().slice(0, 10), hoje)).filter((x) => x > 5 && x < 100);
  const faixas = Object.fromEntries(FAIXAS_ETARIAS.map((f) => [f, 0])) as Record<string, number>;
  for (const i of idades) faixas[faixaEtaria(i)]++;

  // ---- quem mais gastou no periodo (servicos avulsos + comandas + mensalidades)
  const [gastoServ, gastoCom, gastoAss] = await Promise.all([
    db.agendamento.groupBy({ by: ["clienteId"], where: { status: "CONCLUIDO", assinaturaId: null, inicio: intervalo(p.de, p.ate) }, _sum: { precoCentavos: true }, _count: true }),
    db.itemComanda.findMany({ where: { produtoId: { not: null }, comanda: { status: "FECHADA", fechadaEm: intervalo(p.de, p.ate), clienteId: { not: null } } }, select: { quantidade: true, precoUnitCentavos: true, comanda: { select: { clienteId: true } } } }),
    db.cobranca.findMany({ where: { status: "PAGA", pagaEm: intervalo(p.de, p.ate) }, select: { valorCentavos: true, assinatura: { select: { clienteId: true } } } }),
  ]);
  const gasto = new Map<string, number>();
  const somar = (id: string | null | undefined, v: number) => id && gasto.set(id, (gasto.get(id) ?? 0) + v);
  for (const g of gastoServ) somar(g.clienteId, g._sum.precoCentavos ?? 0);
  for (const i of gastoCom) somar(i.comanda.clienteId, i.quantidade * i.precoUnitCentavos);
  for (const c of gastoAss) somar(c.assinatura.clienteId, c.valorCentavos);
  const topIds = [...gasto.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const topNomes = await db.cliente.findMany({ where: { id: { in: topIds.map(([id]) => id) } }, select: { id: true, nome: true } });
  const visitasNoPeriodo = new Map<string, number>();
  for (const a of await db.agendamento.groupBy({ by: ["clienteId"], where: { status: "CONCLUIDO", inicio: intervalo(p.de, p.ate), clienteId: { in: topIds.map(([id]) => id) } }, _count: true })) visitasNoPeriodo.set(a.clienteId, a._count);

  // ---- indicacoes do periodo
  const [indNovas, indConvertidas, porIndicador] = await Promise.all([
    db.indicacao.count({ where: { criadoEm: intervalo(p.de, p.ate) } }),
    db.indicacao.count({ where: { convertidaEm: intervalo(p.de, p.ate) } }),
    db.indicacao.groupBy({ by: ["indicadorId"], where: { convertidaEm: { not: null } }, _count: true, orderBy: { _count: { indicadorId: "desc" } }, take: 5 }),
  ]);
  const nomesIndicadores = await db.cliente.findMany({ where: { id: { in: porIndicador.map((x) => x.indicadorId) } }, select: { id: true, nome: true } });

  return {
    atual,
    anterior,
    indicacoes: {
      novas: indNovas,
      convertidas: indConvertidas,
      top: porIndicador.map((x) => ({ nome: nomesIndicadores.find((n) => n.id === x.indicadorId)?.nome || "(sem nome)", amigos: x._count })),
    },
    agenda: {
      criados: criados.length,
      cancelados,
      canais,
      antecedenciaMediaH: media(antecedencias),
      taxaFalta: atual.atendimentos + atual.faltas ? atual.faltas / (atual.atendimentos + atual.faltas) : null,
    },
    clientes: {
      novos: novosIds.length,
      origens,
      base,
      frequencia: { mediaDias: media(intervalos), medianaDias: mediana(intervalos), clientesComRetorno: intervalos.length, distribuicao: distFreq },
      retorno,
      idade: { media: media(idades), preenchidos: idades.length, atendidos: atendidosIds.length, faixas },
      top: topIds.map(([id, v]) => ({ id, nome: topNomes.find((n) => n.id === id)?.nome || "(sem nome)", gastoCentavos: v, visitas: visitasNoPeriodo.get(id) ?? 0 })),
    },
  };
}
