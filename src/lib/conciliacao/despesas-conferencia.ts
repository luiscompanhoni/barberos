import { Prisma } from "@prisma/client";
import type { Sessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { auditar } from "@/lib/auditoria";
import { ErroNegocio } from "@/lib/erros";
import { janelaMes } from "@/lib/financeiro/despesas";
import { exigirDonoConciliacao } from "./despesas-vinculos";
import { canonicoConferencia, hashConferencia } from "./despesas-hash";
export { canonicoConferencia, hashConferencia } from "./despesas-hash";

export const FONTES_CONFERENCIA = ["CELCASH", "STONE"] as const;
export type FonteConferencia = typeof FONTES_CONFERENCIA[number];

/** Tudo que pode afetar despesa, referência, prova, pendência ou resultado integra o recibo da competência. */
export async function dadosConferenciaMes(tx: Prisma.TransactionClient, competencia: string) {
  const periodo = await janelaMes(competencia, tx), janela = { gte: periodo.gte, lt: periodo.lt };
  const [ano, mes] = competencia.split("-").map(Number);
  const vencimentos = { gte: new Date(Date.UTC(ano, mes - 1, 1)), lt: new Date(Date.UTC(ano, mes, 1)) };
  const [movimentos, despesas, vinculos, cobrancas, comandas, antecipados, links, estornos, taxas, historicos, decisoes] = await Promise.all([
    tx.movimentoExterno.findMany({ where: { data: janela }, orderBy: { id: "asc" } }),
    tx.despesa.findMany({ where: { OR: [{ pagoEm: janela }, { vencimento: vencimentos }, { vinculosExternos: { some: { movimento: { data: janela } } } }] }, orderBy: { id: "asc" } }),
    tx.vinculoDespesaExterna.findMany({ where: { OR: [{ movimento: { data: janela } }, { despesa: { pagoEm: janela } }] }, include: { movimento: true, despesa: true }, orderBy: { id: "asc" } }),
    tx.cobranca.findMany({ where: { OR: [{ recebidoConfirmadoEm: janela }, { pagaEm: janela }, { vencimento: vencimentos }] }, select: { id: true, status: true, valorCentavos: true, pagaEm: true, gatewayId: true, valorRecebidoConfirmadoCentavos: true, recebidoConfirmadoEm: true, provaRecebimento: true, recebimentoPendente: true }, orderBy: { id: "asc" } }),
    tx.comanda.findMany({ where: { OR: [{ fechadaEm: janela }, { abertaEm: janela }] }, select: { id: true, status: true, fechadaEm: true, descontoCentavos: true, itens: { orderBy: { id: "asc" } }, pagamentos: { orderBy: { id: "asc" } } }, orderBy: { id: "asc" } }),
    tx.pagamentoAntecipado.findMany({ where: { pagoEm: janela }, select: { id: true, status: true, valorCentavos: true, pagoEm: true }, orderBy: { id: "asc" } }),
    tx.linkPagamento.findMany({ where: { pagoEm: janela }, select: { id: true, status: true, valorCentavos: true, pagoEm: true }, orderBy: { id: "asc" } }),
    tx.pedidoEstorno.findMany({ where: { OR: [{ executadoEm: janela }, { criadoEm: janela }] }, select: { id: true, status: true, valorCentavos: true, executadoEm: true, referenciaId: true }, orderBy: { id: "asc" } }),
    tx.taxaRecebimento.findMany({ orderBy: { forma: "asc" } }),
    tx.vinculoCobrancaExterna.findMany({ where: { OR: [{ cobranca: { OR: [{ recebidoConfirmadoEm: janela }, { pagaEm: janela }, { vencimento: vencimentos }] } }, { recebimento: { data: janela } }, { estornoMovimento: { data: janela } }] }, select: { id: true, cobrancaId: true, recebimentoId: true, estornoMovimentoId: true, evidencia: true }, orderBy: { id: "asc" } }),
    tx.auditoria.findMany({ where: { acao: "despesa_coincidencia_distinta", entidade: "coincidencia_despesa", dados: { path: ["competencia"], equals: competencia } }, select: { id: true, usuarioId: true, criadoEm: true, dados: true }, orderBy: { id: "asc" } }),
  ]);
  const referencias = { cobrancas: cobrancas.map(({ provaRecebimento, recebimentoPendente, ...c }) => ({ ...c, provaHash: hashConferencia(provaRecebimento), pendenciaHash: hashConferencia(recebimentoPendente) })), comandas, antecipados, links, estornos, taxas, decisoes, historicos: historicos.map(({ evidencia, ...h }) => ({ ...h, evidenciaHash: hashConferencia(evidencia) })) };
  const porFonte = Object.fromEntries(FONTES_CONFERENCIA.map(fonte => {
    const snapshot = JSON.parse(canonicoConferencia({ versao: 1, fonte, competencia, de: periodo.gte, ateExclusivo: periodo.lt, movimentos: movimentos.filter(m => m.fonte === fonte).map(({ bruto, ...m }) => ({ ...m, brutoHash: hashConferencia(bruto) })), despesas, vinculos: vinculos.map(({ movimento, despesa, ...v }) => ({ ...v, movimentoHash: hashConferencia(movimento), despesaHash: hashConferencia(despesa) })), referencias }));
    return [fonte, { hashDados: hashConferencia(snapshot), snapshot: snapshot as Prisma.InputJsonValue }];
  })) as Record<FonteConferencia, { hashDados: string; snapshot: Prisma.InputJsonValue }>;
  return { periodo, movimentos, despesas, vinculos, decisoes, porFonte };
}

export async function conferirExtratoMes(s: Sessao, competencia: string, fonte: FonteConferencia, hashDados: string, motivo: string) {
  exigirDonoConciliacao(s);
  if (motivo.trim().length < 5) throw new ErroNegocio("Descreva a evidência de cobertura do mês completo.");
  return db.$transaction(async tx => {
    const dados = await dadosConferenciaMes(tx, competencia);
    if (+dados.periodo.lt > Date.now()) throw new ErroNegocio("O mês ainda não terminou. Continue acompanhando a prévia e confira após o fechamento.", 409, "mes_em_andamento");
    if (dados.porFonte[fonte].hashDados !== hashDados) throw new ErroNegocio("Os dados mudaram após sua leitura. Recarregue e confira novamente o extrato completo.", 409, "conferencia_desatualizada");
    const c = await tx.conferenciaExtrato.create({ data: { fonte, competencia, hashDados, snapshot: dados.porFonte[fonte].snapshot, criadoPorId: s.usuarioId } });
    await auditar(tx, s.usuarioId, "extrato_conferir_mes", "conferencia_extrato", c.id, { fonte, competencia, hashDados, mesCompleto: true, motivo: motivo.trim() });
    return c;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000 });
}
