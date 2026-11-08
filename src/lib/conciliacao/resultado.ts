/**
 * Resultado do mes lado a lado: o faturamento registrado no BarberOS, o que caiu na Celcash (mensalidades) e na
 * Stone (maquininha e Pix), as taxas, as saidas (pagamentos por categoria, retiradas do socio, transferencias) e o
 * lucro, com as divergencias marcadas.
 */
import type { Sessao } from "@/lib/auth/sessao";
import { Prisma } from "@prisma/client";
import { auditar } from "@/lib/auditoria";
import { db } from "@/lib/db";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import { taxas } from "@/lib/financeiro/conciliacao";
import { janelaMes } from "@/lib/financeiro/despesas";
import { resumoMes } from "@/lib/financeiro/resumo";
import { divergente, resumirExtrato, type TipoExterno } from "./regras";
import { salvarRegra } from "./stone";
import { dadosConferenciaMes, FONTES_CONFERENCIA } from "./despesas-conferencia";
import { parDespesaValido } from "./despesas-vinculos";
import { parDecididoDistinto } from "./despesas-hash";

/** Categorias de saida que NAO sao despesa da operacao (nao entram no lucro). */
export const NAO_DESPESA = ["RETIRADA_SOCIO"] as const;
const naoDespesa = (c: string | null) => !!c && (NAO_DESPESA as readonly string[]).includes(c);
const reais = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

type Mov = { id: string; fonte: string; tipo: TipoExterno; forma: string | null; valorCentavos: number; categoria: string | null };

/** Saidas classificadas de uma fonte: despesa por categoria, retiradas e o que falta classificar. */
function saidas(movs: Mov[]) {
  const pag = movs.filter((m) => m.tipo === "PAGAMENTO");
  const porCategoria: Record<string, number> = {};
  for (const m of pag) if (m.categoria && !naoDespesa(m.categoria)) porCategoria[m.categoria] = (porCategoria[m.categoria] ?? 0) - m.valorCentavos;
  return {
    despesa: Object.values(porCategoria).reduce((t, v) => t + v, 0),
    porCategoria,
    retiradas: -pag.filter((m) => m.categoria === "RETIRADA_SOCIO").reduce((t, m) => t + m.valorCentavos, 0),
    semCategoria: -pag.filter((m) => !m.categoria).reduce((t, m) => t + m.valorCentavos, 0),
  };
}

export async function resultadoDoMes(mes: string) {
  await taxas(); // Preserva inicialização dos padrões; a leitura abaixo é um snapshot único.
  return db.$transaction(c => resultadoDentroTx(mes, c), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000 });
}

async function resultadoDentroTx(mes: string, c: Prisma.TransactionClient) {
  const [r, dados, ultimos, tx, historicosDivergentes, conferidas] = await Promise.all([
    resumoMes(mes, c), dadosConferenciaMes(c, mes),
    c.movimentoExterno.groupBy({ by: ["fonte"], _max: { data: true } }),
    c.taxaRecebimento.findMany(),
    c.vinculoCobrancaExterna.findMany({ where: { evidencia: { path: ["divergenciaGateway", "pendente"], equals: true } }, select: { transacaoId: true }, orderBy: { transacaoId: "asc" }, take: 50 }),
    c.conferenciaExtrato.findMany({ where: { competencia: mes }, orderBy: [{ criadoEm: "desc" }, { id: "desc" }], select: { id: true, fonte: true, hashDados: true, criadoEm: true } }),
  ]);
  const movs = dados.movimentos;
  const ativos = dados.vinculos.filter(v => !v.anuladoEm);
  const validos = ativos.filter(v => parDespesaValido(v.movimento, v.despesa));
  const invalidos = ativos.filter(v => !parDespesaValido(v.movimento, v.despesa));
  const idsVinculados = new Set(validos.map(v => v.movimentoId));
  const despesasVinculadas = new Set(validos.map(v => v.despesaId));
  let coincidenciasDistintas = 0;
  const duplicatas = movs.filter(m => m.tipo === "PAGAMENTO" && m.valorCentavos < 0 && !idsVinculados.has(m.id)).map(m => ({ movimentoId: m.id, descricao: m.observacao ?? m.descricao, data: m.data, valorCentavos: -m.valorCentavos, despesas: dados.despesas.filter(d => {
    if (despesasVinculadas.has(d.id) || !parDespesaValido(m, d)) return false;
    if (dados.decisoes.some(decisao => parDecididoDistinto(decisao.dados, m, d))) { coincidenciasDistintas++; return false; }
    return true;
  }).map(d => ({ id: d.id, descricao: d.descricao, pagoEm: d.pagoEm, forma: d.formaPagamento })) })).filter(x => x.despesas.length);
  const conferencias = FONTES_CONFERENCIA.map(fonte => {
    const ultima = conferidas.find(x => x.fonte === fonte);
    return { fonte, hashDados: dados.porFonte[fonte].hashDados, conferida: !!ultima && ultima.hashDados === dados.porFonte[fonte].hashDados && +dados.periodo.lt <= Date.now(), ultima: ultima ? { id: ultima.id, criadoEm: ultima.criadoEm } : null };
  });
  const celcashMovs = movs.filter((m) => m.fonte === "CELCASH") as Mov[];
  const stoneMovs = movs.filter((m) => m.fonte === "STONE") as Mov[];
  const celcash = { ...resumirExtrato(celcashMovs), ...saidas(celcashMovs.filter(m => !idsVinculados.has(m.id))) };
  const stone = { ...resumirExtrato(stoneMovs), ...saidas(stoneMovs.filter(m => !idsVinculados.has(m.id))) };

  // Taxa da maquininha nao vem no extrato (a Stone ja deposita liquido): estimada pelas taxas configuradas.
  const pf = r.receitas.comandas.porForma;
  const taxa = (f: string) => tx.find((t) => t.forma === f)?.taxaBps ?? 0;
  const maquininhaEstimada = Math.round(((pf.DEBITO ?? 0) * taxa("DEBITO") + (pf.CREDITO ?? 0) * taxa("CREDITO") + (pf.PIX ?? 0) * taxa("PIX")) / 10_000);

  const mensalidades = r.receitas.mensalidades.total;
  const mensalidadesPorFonte = r.receitas.mensalidades.porFonte ?? { celcash: 0, pagarme: 0, asaas: 0, simulado: 0, indefinida: mensalidades };
  const mensalidadesCelcash = mensalidadesPorFonte.celcash;
  const cartaoRegistrado = (pf.DEBITO ?? 0) + (pf.CREDITO ?? 0);
  const custoTaxas = celcash.custoGateway + stone.custoGateway; // Estimativa nunca soma com taxa observada.
  const despesas = r.despesas.total + celcash.despesa + stone.despesa;
  const lucro = r.receitas.total - custoTaxas - despesas;

  const alertas: string[] = [];
  for (const [fonte, valor] of Object.entries(mensalidadesPorFonte)) if (fonte !== "celcash" && valor > 0) alertas.push(`${fonte === "simulado" ? "Receita simulada" : `Receita de mensalidades ${fonte === "indefinida" ? "sem origem confirmada" : fonte === "pagarme" ? "Pagar.me" : "Asaas"}`} (${reais(valor)}) permanece separada e sem cobertura específica neste resultado. Não compensa diferenças da Celcash.`);
  if (!r.receitas.mensalidades.completo) alertas.push(`${r.receitas.mensalidades.pendentes} mensalidade(s) sem valor/data de recebimento comprovados: o valor nominal não entrou na receita.`);
  if (conferencias.some(x => !x.conferida)) alertas.push("Cobertura do mês completo da Celcash e Stone ainda não conferida pelo dono, ou dados alterados após a conferência.");
  if (duplicatas.length) alertas.push(`${duplicatas.length} saída(s) podem repetir despesas locais. Vincule somente após comprovar; os valores permanecem separados até a decisão.`);
  if (invalidos.length) alertas.push(`${invalidos.length} vínculo(s) de despesa têm status ou valor incompatíveis. Não foram deduplicados; revise e anule o vínculo incorreto.`);
  if (movs.some(m => m.categoria === "JA_LANCADA" && !idsVinculados.has(m.id))) alertas.push("Há saídas marcadas como já lançadas sem vínculo comprovado. Essa etiqueta não exclui valores automaticamente.");
  if (movs.some(m => m.tipo === "OUTRO")) alertas.push("Há movimentos do extrato sem natureza definida. Revise as classificações antes de concluir a conferência.");
  if (maquininhaEstimada > 0) alertas.push("A taxa estimada da maquininha é informativa e está fora das taxas observadas e do resultado. Confira a liquidação real.");
  if (validos.some(v => v.despesa.pagoEm && (v.despesa.pagoEm < dados.periodo.gte || v.despesa.pagoEm >= dados.periodo.lt))) alertas.push("Há despesa vinculada a movimento em outra competência. As datas foram preservadas; revise o período de reconhecimento.");
  if (historicosDivergentes.length) alertas.push(`A Celcash mudou após a conciliação. Confira em Corrigir histórico as transações: ${historicosDivergentes.map((v) => v.transacaoId).join(", ")}${historicosDivergentes.length === 50 ? " (primeiras 50)" : ""}. Os registros foram preservados.`);
  if (divergente(mensalidadesCelcash, celcash.recebido)) {
    alertas.push(`Mensalidades da Celcash registradas (${reais(mensalidadesCelcash)}) diferentes do que caiu na Celcash (${reais(celcash.recebido)}): diferença de ${reais(celcash.recebido - mensalidadesCelcash)}.`);
  }
  if (stoneMovs.length && (divergente(cartaoRegistrado, stone.recebidoPorForma.CARTAO ?? 0) || divergente(pf.PIX ?? 0, stone.recebidoPorForma.PIX ?? 0))) alertas.push("Os recebimentos Stone diferem dos registros por cartão/Pix. Taxas e datas de liquidação precisam ser comprovadas antes do fechamento.");
  if (movs.some(m => !["STONE", "CELCASH"].includes(m.fonte))) alertas.push("Há movimentos de outra fonte sem cobertura bancária neste resultado. Revise a origem antes do fechamento.");
  const semCat = celcash.semCategoria + stone.semCategoria;
  if (semCat > 0) alertas.push(`${reais(semCat)} saíram para terceiros sem categoria: classifique para entrar no lucro.`);
  if (!stoneMovs.length && !conferencias.find(x => x.fonte === "STONE")?.conferida) alertas.push("Sem extrato da Stone neste mês: suba o CSV ou confira explicitamente um extrato completo sem movimentação.");

  const porCategoria: Record<string, number> = { ...r.despesas.porCategoria };
  for (const s of [celcash, stone]) for (const [c, v] of Object.entries(s.porCategoria)) porCategoria[c] = (porCategoria[c] ?? 0) + v;

  return {
    mes,
    sincronizadoAte: Object.fromEntries(ultimos.map((u) => [u.fonte, u._max.data])),
    registrado: {
      total: r.receitas.total, comandas: r.receitas.comandas.total, porForma: pf, mensalidades, mensalidadesPorFonte, mensalidadesCelcash,
      antecipados: r.receitas.antecipados.total, links: r.receitas.links.total, estornos: r.receitas.estornos.total,
    },
    celcash,
    stone,
    custos: { celcash: celcash.custoGateway, stone: stone.custoGateway, maquininhaEstimada, total: custoTaxas },
    despesas: { barberos: r.despesas.total, celcash: celcash.despesa, stone: stone.despesa, total: despesas, porCategoria },
    retiradas: celcash.retiradas + stone.retiradas,
    lucro,
    status: alertas.length ? "PREVIA" as const : "CONFERIDO" as const,
    conferencias,
    conciliacaoDespesas: {
      coincidenciasDistintas,
      possiveisDuplicatas: duplicatas,
      vinculos: ativos.map(v => ({ id: v.id, movimentoId: v.movimentoId, despesaId: v.despesaId, descricao: v.despesa.descricao, valorCentavos: v.despesa.valorCentavos, valido: !invalidos.some(x => x.id === v.id) })),
    },
    divergencias: {
      mensalidades: celcash.recebido - mensalidadesCelcash,
      // Cartao: o registrado e bruto; na Stone cai liquido e em outro dia (a diferenca mistura taxa e prazo).
      cartao: (stone.recebidoPorForma.CARTAO ?? 0) - cartaoRegistrado,
      pix: (stone.recebidoPorForma.PIX ?? 0) - (pf.PIX ?? 0),
    },
    alertas,
  };
}

/** Movimentos externos do mes (para conferir e classificar). */
export async function movimentosDoMes(mes: string, tipo?: TipoExterno) {
  const janela = await janelaMes(mes);
  return db.movimentoExterno.findMany({
    where: { data: { gte: janela.gte, lt: janela.lt }, ...(tipo ? { tipo } : {}) },
    orderBy: { data: "desc" }, take: 3000,
    select: { id: true, fonte: true, data: true, valorCentavos: true, tipo: true, forma: true, descricao: true, categoria: true, observacao: true, classificadoPorId: true },
  });
}

/** O dono corrige o tipo/categoria de um movimento. `lembrar`: vira regra para esse nome (vale para os proximos). */
export async function classificarMovimento(s: Sessao, id: string, d: { tipo: TipoExterno; categoria: string | null; observacao?: string | null; lembrar?: boolean }) {
  const m = await db.movimentoExterno.findUnique({ where: { id } });
  if (!m) throw naoEncontrado("Movimento");
  if (d.tipo === "PAGAMENTO" && m.valorCentavos > 0) throw new ErroNegocio("Entrada não pode ser pagamento.");
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM movimentos_externos WHERE id = ${id} FOR UPDATE`;
    const atual = await tx.movimentoExterno.findUniqueOrThrow({ where: { id } });
    if (d.tipo !== atual.tipo && await tx.vinculoCobrancaExterna.findFirst({ where: { OR: [{ recebimentoId: id }, { estornoMovimentoId: id }] }, select: { id: true } })) {
      throw new ErroNegocio("O tipo deste movimento comprova uma correção histórica e não pode ser alterado.", 409);
    }
    if (d.tipo !== atual.tipo && await tx.vinculoDespesaExterna.findFirst({ where: { movimentoId: id, anuladoEm: null }, select: { id: true } })) throw new ErroNegocio("Este movimento comprova uma despesa. Anule o vínculo com justificativa antes de mudar o tipo.", 409, "despesa_vinculada");
    if (d.categoria === "JA_LANCADA") throw new ErroNegocio("Use a conciliação de despesas para comprovar o vínculo. A etiqueta já lançada não substitui a conferência.", 409, "vinculo_necessario");
    if (d.tipo === "PAGAMENTO" && atual.valorCentavos > 0) throw new ErroNegocio("Entrada não pode ser pagamento.");
    const categoria = d.tipo === "PAGAMENTO" ? d.categoria : null;
    const observacao = d.observacao ?? atual.observacao;
    await tx.movimentoExterno.update({ where: { id }, data: { tipo: d.tipo, categoria, observacao, classificadoPorId: s.usuarioId } });
    await auditar(tx, s.usuarioId, "conciliacao_classificar", "movimento_externo", id, { antes: { tipo: atual.tipo, categoria: atual.categoria, observacao: atual.observacao }, depois: { tipo: d.tipo, categoria, observacao }, descricao: atual.descricao });
  });
  if (d.lembrar && m.observacao) return { aplicadas: await salvarRegra(s, { padrao: m.observacao, tipo: d.tipo, categoria: d.tipo === "PAGAMENTO" ? d.categoria : null }) };
  return { aplicadas: 0 };
}
