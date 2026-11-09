import type { OrigemAgendamento } from "@prisma/client";
import { auditar } from "@/lib/auditoria";
import { db } from "@/lib/db";
import { ErroNegocio } from "@/lib/erros";
import { gatewayPorId } from "@/lib/pagamentos/gateway";
import { elegivelIndicacaoAssinatura, limiteIndicacaoAssinatura, PREMIO_INDICADO, PREMIO_INDICADOR, REGRA_INDICACAO_ASSINATURA, validadeIndicacao } from "./indicacao-assinatura-regras";

export async function registrarIndicacaoAssinatura(indicadoId: string, indicador: { id: string; nome: string; telefone: string }, origem: OrigemAgendamento) {
  return db.$transaction(async (tx) => {
    // A mesma trava protege o teto agregado e a corrida entre dois códigos.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('indicacao-assinatura-v2', 0))`;
    await tx.$queryRaw`SELECT 1 FROM clientes WHERE id = ${indicadoId} FOR UPDATE`;
    if (await tx.indicacao.findUnique({ where: { indicadoId } })) throw new ErroNegocio("Esse cliente já tem uma indicação registrada.");
    const contratos = await tx.assinatura.findMany({ where: { clienteId: indicadoId }, select: { status: true, canceladaEm: true, encerraEm: true } });
    if (!elegivelIndicacaoAssinatura(contratos, new Date())) throw new ErroNegocio("A indicação vale para novos assinantes ou quem está há pelo menos 90 dias sem plano. A recepção pode conferir seu caso.");
    const comprometido = await tx.indicacao.aggregate({ where: { regra: REGRA_INDICACAO_ASSINATURA }, _sum: { premioIndicadorCentavos: true, premioIndicadoCentavos: true } });
    const total = (comprometido._sum.premioIndicadorCentavos ?? 0) + (comprometido._sum.premioIndicadoCentavos ?? 0);
    if (total + PREMIO_INDICADOR + PREMIO_INDICADO > limiteIndicacaoAssinatura()) throw new ErroNegocio("O lote de indicações chegou ao limite. A recepção pode orientar o próximo passo.", 409, "indicacao_limite");
    const indicacao = await tx.indicacao.create({ data: { indicadorId: indicador.id, indicadoId, origem, regra: REGRA_INDICACAO_ASSINATURA, premioIndicadorCentavos: PREMIO_INDICADOR, premioIndicadoCentavos: PREMIO_INDICADO } });
    // Preserva a origem inicial de aquisição; o vínculo da indicação já tem registro próprio.
    await auditar(tx, null, "indicacao_assinatura_registrada", "indicacao", indicacao.id, { regra: REGRA_INDICACAO_ASSINATURA });
    return { indicacao, indicador, premioCentavos: 0, aguardandoPagamento: true };
  });
}

export async function converterIndicacoesAssinatura(opts: { clienteIds?: string[] } = {}) {
  const pendentes = await db.indicacao.findMany({
    where: { regra: REGRA_INDICACAO_ASSINATURA, convertidaEm: null, estornadaEm: null, ...(opts.clienteIds ? { indicadorId: { in: opts.clienteIds } } : {}) },
    include: { indicador: { select: { id: true, nome: true, telefone: true } }, indicado: { select: { nome: true } } },
    orderBy: { criadoEm: "asc" },
  });
  const premiados = [];
  for (const p of pendentes) {
    if (p.premioIndicadorCentavos !== PREMIO_INDICADOR || p.premioIndicadoCentavos !== PREMIO_INDICADO) continue;
    const cob = await db.cobranca.findFirst({
      where: { status: "PAGA", pagaEm: { gte: p.criadoEm }, valorCentavos: { gt: 0 }, assinatura: { clienteId: p.indicadoId, criadaEm: { gte: p.criadoEm }, status: "ATIVA", migracao: null, gatewayId: { not: null } } },
      include: { assinatura: true }, orderBy: { pagaEm: "asc" },
    });
    if (!cob || !/^(sub_|pixrec_|sim)/.test(cob.assinatura.gatewayId!)) continue;
    try {
      const prova = await (await gatewayPorId(cob.gatewayId)).buscarCobranca(cob.gatewayId);
      if (prova.id !== cob.gatewayId || prova.status !== "PAGA" || !prova.pagaEm || !Number.isFinite(+new Date(prova.pagaEm)) || +new Date(prova.pagaEm) < +p.criadoEm || +new Date(prova.pagaEm) > Date.now() || prova.valorCentavos !== cob.valorCentavos || prova.assinaturaGatewayId !== cob.assinatura.gatewayId) continue;
    } catch { continue; }
    const concedida = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM cobrancas WHERE id = ${cob.id} FOR UPDATE`;
      const atual = await tx.cobranca.findUnique({ where: { id: cob.id }, include: { assinatura: true } });
      if (!atual || atual.status !== "PAGA" || atual.gatewayId !== cob.gatewayId || atual.valorCentavos !== cob.valorCentavos || atual.assinatura.status !== "ATIVA" || atual.assinatura.gatewayId !== cob.assinatura.gatewayId) return false;
      const agora = new Date();
      const alterada = await tx.indicacao.updateMany({ where: { id: p.id, convertidaEm: null, estornadaEm: null }, data: { convertidaEm: agora, cobrancaConversaoId: cob.id } });
      if (!alterada.count) return false;
      const expiraEm = validadeIndicacao(agora);
      await tx.beneficio.createMany({ data: [
        { clienteId: p.indicadorId, descricao: "Crédito por indicação de assinatura", valorCentavos: p.premioIndicadorCentavos!, motivo: "INDICOU", indicacaoId: p.id, expiraEm },
        { clienteId: p.indicadoId, descricao: "Crédito pela primeira assinatura indicada", valorCentavos: p.premioIndicadoCentavos!, motivo: "INDICADO", indicacaoId: p.id, expiraEm },
      ] });
      await auditar(tx, null, "indicacao_assinatura_convertida", "indicacao", p.id, { cobrancaId: cob.id, expiraEm: expiraEm.toISOString() });
      return true;
    });
    if (concedida) premiados.push({ indicacaoId: p.id, indicador: p.indicador, amigo: p.indicado.nome, premio: p.premioIndicadorCentavos!, assinatura: true });
  }
  return premiados;
}

/** Estorno não gera dívida nem débito automático; créditos usados exigem análise gerencial. */
export async function revisarIndicacaoEstornada(cobrancaId: string) {
  await db.$transaction(async (tx) => {
    const ind = await tx.indicacao.findUnique({ where: { cobrancaConversaoId: cobrancaId }, include: { beneficios: true } });
    if (!ind || ind.estornadaEm) return;
    for (const clienteId of [ind.indicadorId, ind.indicadoId].sort()) await tx.$queryRaw`SELECT 1 FROM clientes WHERE id = ${clienteId} FOR UPDATE`;
    const ids = ind.beneficios.map((b) => b.id);
    const creditos = await tx.beneficio.findMany({ where: { OR: [{ id: { in: ids } }, { origemBeneficioId: { in: ids } }] } });
    const reservas = creditos.flatMap((b) => b.reservaCreditoId ? [b.reservaCreditoId] : []);
    if (reservas.length) await tx.reservaCreditoAssinatura.updateMany({ where: { id: { in: reservas } }, data: { estado: "REVISAO" } });
    await tx.beneficio.updateMany({ where: { id: { in: creditos.filter((b) => b.status === "DISPONIVEL").map((b) => b.id) } }, data: { status: "CANCELADO" } });
    await tx.indicacao.update({ where: { id: ind.id }, data: { estornadaEm: new Date() } });
    await auditar(tx, null, "indicacao_assinatura_estornada", "indicacao", ind.id, { cobrancaId, creditosUsadosOuReservados: creditos.some((b) => b.status === "USADO") });
  });
}
