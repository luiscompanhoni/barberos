/**
 * Indicadores de um barbeiro no periodo, comparados com a media da equipe.
 */
import { configuracao } from "@/lib/agenda/carregar";
import { minutosLocal } from "@/lib/agenda/tempo";
import { db } from "@/lib/db";
import { naoEncontrado } from "@/lib/erros";
import { ocupacaoDosDias } from "./ocupacao";
import type { Periodo } from "./periodo";

const DIA = 86_400_000;
const intervalo = (de: number, ate: number) => ({ gte: new Date(de), lt: new Date(ate) });

/** Resumo por barbeiro para o ranking da equipe. */
export async function rankingDaEquipe(p: Periodo) {
  const [ocup, ags, itens] = await Promise.all([
    ocupacaoDosDias(p.dias),
    db.agendamento.findMany({ where: { inicio: intervalo(p.de, p.ate), status: { in: ["CONCLUIDO", "FALTOU"] } }, select: { barbeiroId: true, clienteId: true, status: true, precoCentavos: true, assinaturaId: true } }),
    db.itemComanda.findMany({ where: { produtoId: { not: null }, barbeiroId: { not: null }, comanda: { status: "FECHADA", fechadaEm: intervalo(p.de, p.ate) } }, select: { barbeiroId: true, quantidade: true, precoUnitCentavos: true } }),
  ]);
  const vendasPorBarbeiro = new Map<string, number>();
  for (const i of itens) vendasPorBarbeiro.set(i.barbeiroId!, (vendasPorBarbeiro.get(i.barbeiroId!) ?? 0) + i.quantidade * i.precoUnitCentavos);
  return {
    total: ocup.total,
    porDiaSemana: ocup.porDiaSemana,
    porDia: ocup.porDia,
    barbeiros: ocup.porBarbeiro.map((b) => {
      const seus = ags.filter((a) => a.barbeiroId === b.id);
      const feitos = seus.filter((a) => a.status === "CONCLUIDO");
      const avulsos = feitos.filter((a) => !a.assinaturaId);
      const receita = avulsos.reduce((s, a) => s + a.precoCentavos, 0);
      return {
        ...b,
        atendimentos: feitos.length,
        clientes: new Set(feitos.map((a) => a.clienteId)).size,
        peloPlanoPct: feitos.length ? (feitos.length - avulsos.length) / feitos.length : null,
        receitaServicosCentavos: receita,
        ticketAvulsoCentavos: avulsos.length ? Math.round(receita / avulsos.length) : null,
        faltas: seus.length - feitos.length,
        taxaFalta: seus.length ? (seus.length - feitos.length) / seus.length : null,
        vendasProdutosCentavos: vendasPorBarbeiro.get(b.id) ?? 0,
      };
    }),
  };
}

export async function indicadoresDoBarbeiro(barbeiroId: string, p: Periodo, agora = Date.now()) {
  const cfg = await configuracao();
  const barbeiro = await db.barbeiro.findUnique({ where: { id: barbeiroId }, select: { id: true, nome: true, cor: true } });
  if (!barbeiro) throw naoEncontrado("Barbeiro");
  const [ocup, equipe, ags, itens, historico] = await Promise.all([
    ocupacaoDosDias(p.dias, [barbeiroId]),
    ocupacaoDosDias(p.dias),
    db.agendamento.findMany({
      where: { barbeiroId, inicio: intervalo(p.de, p.ate), status: { in: ["CONCLUIDO", "FALTOU"] } },
      select: { clienteId: true, status: true, precoCentavos: true, assinaturaId: true, inicio: true, servico: { select: { nome: true } } },
    }),
    db.itemComanda.findMany({ where: { barbeiroId, produtoId: { not: null }, comanda: { status: "FECHADA", fechadaEm: intervalo(p.de, p.ate) } }, select: { descricao: true, quantidade: true, precoUnitCentavos: true } }),
    // Visitas com ele nos 180 dias antes do fim do periodo (fidelidade)
    db.agendamento.findMany({ where: { barbeiroId, status: "CONCLUIDO", inicio: intervalo(Math.min(p.ate, agora) - 180 * DIA, Math.min(p.ate, agora)) }, select: { clienteId: true, inicio: true } }),
  ]);
  const feitos = ags.filter((a) => a.status === "CONCLUIDO");
  const avulsos = feitos.filter((a) => !a.assinaturaId);
  const receita = avulsos.reduce((s, a) => s + a.precoCentavos, 0);
  const clientes = new Set(feitos.map((a) => a.clienteId));

  // Clientes novos para ele: primeira vez com esse barbeiro dentro do periodo.
  const primeiras = await db.agendamento.groupBy({ by: ["clienteId"], where: { barbeiroId, status: "CONCLUIDO", clienteId: { in: [...clientes] } }, _min: { inicio: true } });
  const novos = primeiras.filter((x) => +x._min.inicio! >= p.de).length;
  const visitasPorCliente = new Map<string, number>();
  for (const h of historico) visitasPorCliente.set(h.clienteId, (visitasPorCliente.get(h.clienteId) ?? 0) + 1);
  const fieis = [...visitasPorCliente.values()].filter((n) => n >= 2).length;

  const servicos = new Map<string, number>();
  for (const a of feitos) servicos.set(a.servico.nome, (servicos.get(a.servico.nome) ?? 0) + 1);
  const porHora = new Array(24).fill(0);
  for (const a of feitos) porHora[Math.floor(minutosLocal(a.inicio, cfg.fuso) / 60)]++;
  const produtos = new Map<string, { qtd: number; receita: number }>();
  for (const i of itens) {
    const x = produtos.get(i.descricao) ?? { qtd: 0, receita: 0 };
    x.qtd += i.quantidade; x.receita += i.quantidade * i.precoUnitCentavos;
    produtos.set(i.descricao, x);
  }
  const nEquipe = Math.max(1, equipe.porBarbeiro.length);

  return {
    barbeiro,
    ocupacao: ocup.total,
    ocupacaoEquipe: equipe.total,
    porDia: ocup.porDia,
    porDiaSemana: ocup.porDiaSemana,
    atendimentos: feitos.length,
    mediaEquipeAtendimentos: Math.round((await db.agendamento.count({ where: { inicio: intervalo(p.de, p.ate), status: "CONCLUIDO" } })) / nEquipe),
    faltas: ags.length - feitos.length,
    taxaFalta: ags.length ? (ags.length - feitos.length) / ags.length : null,
    peloPlano: feitos.length - avulsos.length,
    receitaServicosCentavos: receita,
    ticketAvulsoCentavos: avulsos.length ? Math.round(receita / avulsos.length) : null,
    clientesUnicos: clientes.size,
    clientesNovos: novos,
    fidelidade: { clientes: visitasPorCliente.size, voltaram: fieis, taxa: visitasPorCliente.size ? fieis / visitasPorCliente.size : null },
    servicos: [...servicos.entries()].sort((a, b) => b[1] - a[1]).map(([nome, qtd]) => ({ nome, qtd })),
    porHora: porHora.map((qtd, hora) => ({ hora, qtd })).filter((h) => h.qtd > 0),
    produtos: [...produtos.entries()].sort((a, b) => b[1].receita - a[1].receita).slice(0, 6).map(([nome, x]) => ({ nome, ...x })),
    vendasProdutosCentavos: itens.reduce((s, i) => s + i.quantidade * i.precoUnitCentavos, 0),
  };
}
