import type { Cobranca } from "@prisma/client";
import { db } from "@/lib/db";
import { auditar } from "@/lib/auditoria";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import { gatewayPorId, type CobrancaAvulsa } from "@/lib/pagamentos/gateway";

const revisao = () => new ErroNegocio("A operação está em conferência. Aguarde a confirmação do cancelamento antes de escolher outra forma de pagamento.", 409, "assinatura_operacao_revisao");

/** Status sozinho não comprova ausência de recebimento ou encerramento da cobrança. */
export function cancelamentoSemRecebimento(c: CobrancaAvulsa, id: string, valorCentavos: number) {
  return c.id === id && c.status === "CANCELADA" && c.valorCentavos === valorCentavos &&
    c.moeda === "BRL" && c.liquidadoCentavos === 0 && !c.pagaEm;
}

function pagamentoAindaDisponivel(c: CobrancaAvulsa, id: string, valorCentavos: number) {
  return c.id === id && c.status === "PENDENTE" && c.forma === "PIX" && c.valorCentavos === valorCentavos &&
    c.moeda === "BRL" && c.liquidadoCentavos === 0 && !c.pagaEm && !!c.expiraEm && Date.parse(c.expiraEm) > Date.now();
}

function cobrancasConferidas(anteriores: Cobranca[], atuais: Cobranca[], manter = false) {
  return atuais.length === anteriores.length && atuais.every(c => {
    const anterior = anteriores.find(a => a.id === c.id);
    return anterior && c.gatewayId === anterior.gatewayId && c.valorCentavos === anterior.valorCentavos &&
      c.status !== "PAGA" && c.status !== "ESTORNADA" && !c.pagaEm && (!manter || c.status === anterior.status);
  });
}

/** O claim é gravado antes de qualquer chamada externa. Uma falha não libera repetição. */
export async function reservarPagamentoInicial(id: string, tipo: "CARTAO" | "PIX") {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`pix-mensal-assinatura:${id}`}, 0))`;
    const a = await tx.assinatura.findUnique({ where: { id }, include: { plano: true, cliente: true } });
    if (!a) throw naoEncontrado("Assinatura");
    if (a.status !== "PENDENTE" || a.ativadaEm) throw new ErroNegocio("Essa assinatura já foi paga ou encerrada. Atualize a tela.", 409, "ja_pago");
    if (a.operacaoInicial) throw revisao();
    if (!a.gatewayClienteId || (tipo === "CARTAO" && (a.formaPagamento !== "CARTAO" || a.gatewayId)) ||
      (tipo === "PIX" && (!a.plano.formasPagamento.includes("PIX") || (a.gatewayId && !a.gatewayId.startsWith("pixrec_"))))) {
      throw new ErroNegocio("Essa operação não aceita a forma de pagamento escolhida. Atualize a tela antes de continuar.", 409, "forma");
    }
    if (await tx.cobranca.findFirst({ where: { assinaturaId: id, status: { in: ["PAGA", "ESTORNADA"] } }, select: { id: true } })) throw revisao();
    if (await tx.emissaoPixMensal.findFirst({ where: { assinaturaId: id, estado: { in: ["EMITINDO", "INCERTA"] } }, select: { id: true } })) throw revisao();
    await tx.assinatura.update({ where: { id }, data: { operacaoInicial: tipo } });
    return a;
  });
}

export async function concluirPagamentoInicial(id: string) {
  await db.assinatura.updateMany({ where: { id, operacaoInicial: { in: ["CRIANDO", "CARTAO", "PIX"] } }, data: { operacaoInicial: null } });
}

export async function marcarPagamentoInicialIncerto(id: string) {
  await db.assinatura.updateMany({ where: { id, operacaoInicial: { in: ["CRIANDO", "CARTAO", "PIX"] } }, data: { operacaoInicial: "INCERTA" } });
}

/** Cancela somente a primeira operação; não encerra assinatura já paga nem executa estorno. */
export async function cancelarOperacaoInicial(id: string, usuarioId: string | null) {
  const a = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`pix-mensal-assinatura:${id}`}, 0))`;
    const atual = await tx.assinatura.findUnique({ where: { id }, include: { cobrancas: true } });
    if (!atual) throw naoEncontrado("Assinatura");
    if (atual.status === "CANCELADA") return atual;
    if (atual.status !== "PENDENTE" || atual.ativadaEm || atual.cobrancas.some(c => c.status === "PAGA" || c.status === "ESTORNADA")) {
      throw new ErroNegocio("O primeiro pagamento já ocorreu. Use o gerenciamento da assinatura; esta ação não faz estornos.", 409, "ja_pago");
    }
    if (atual.operacaoInicial && atual.operacaoInicial !== "CANCELAMENTO_REVISAO") throw revisao();
    if (await tx.emissaoPixMensal.findFirst({ where: { assinaturaId: id, estado: { in: ["EMITINDO", "INCERTA"] } }, select: { id: true } })) throw revisao();
    await tx.assinatura.update({ where: { id }, data: { operacaoInicial: "CANCELANDO" } });
    await auditar(tx, usuarioId, "solicitar_cancelamento_inicial", "assinatura", id, {});
    return atual;
  });
  if (a.status === "CANCELADA") return { cancelada: true, emConferencia: false };

  try {
    // No simulador, cancelar a recorrência é atômico e só alcança cobranças não pagas.
    // No Pagar.me, um Pix pode ser pago entre o GET e o DELETE. Só consultamos,
    // pois o DELETE também estorna cobranças pagas.
    const g = a.gatewayId ? await gatewayPorId(a.gatewayId) : null;
    if (g?.nome === "simulado") await g.cancelarAssinatura(a.gatewayId!);
    const contratoEncerrado = !a.gatewayId || a.gatewayId.startsWith("pixrec_") || g?.nome === "simulado";
    let comprovado = contratoEncerrado;
    for (const c of a.cobrancas) {
      const provedor = await gatewayPorId(c.gatewayId);
      const remota = await provedor.buscarCobrancaAvulsa?.(c.gatewayId);
      if (!remota || !cancelamentoSemRecebimento(remota, c.gatewayId, c.valorCentavos)) comprovado = false;
    }
    if (!comprovado) {
      await db.assinatura.updateMany({ where: { id, operacaoInicial: "CANCELANDO", status: "PENDENTE" }, data: { operacaoInicial: "CANCELAMENTO_REVISAO" } });
      return { cancelada: false, emConferencia: true };
    }
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`pix-mensal-assinatura:${id}`}, 0))`;
      const corrente = await tx.assinatura.findUniqueOrThrow({ where: { id }, include: { cobrancas: true } });
      if (corrente.operacaoInicial !== "CANCELANDO" || corrente.status !== "PENDENTE" || corrente.ativadaEm ||
        corrente.gatewayId !== a.gatewayId || !cobrancasConferidas(a.cobrancas, corrente.cobrancas)) throw revisao();
      await tx.cobranca.updateMany({ where: { assinaturaId: id, status: { in: ["PENDENTE", "ATRASADA"] } }, data: { status: "CANCELADA" } });
      await tx.assinatura.update({ where: { id }, data: { status: "CANCELADA", canceladaEm: new Date(), motivoCancelamento: "Desistência antes do primeiro pagamento", operacaoInicial: null } });
      await auditar(tx, usuarioId, "cancelar_operacao_inicial", "assinatura", id, { cobrancas: a.cobrancas.map(c => c.id) });
    });
    return { cancelada: true, emConferencia: false };
  } catch {
    await db.assinatura.updateMany({ where: { id, operacaoInicial: "CANCELANDO" }, data: { operacaoInicial: "CANCELAMENTO_REVISAO" } });
    throw revisao();
  }
}

/** Desfaz o pedido de cancelamento somente quando o Pix original continua aberto e sem recebimento. */
export async function manterOperacaoInicial(id: string, usuarioId: string | null) {
  const a = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`pix-mensal-assinatura:${id}`}, 0))`;
    const atual = await tx.assinatura.findUnique({ where: { id }, include: { cobrancas: true } });
    if (!atual) throw naoEncontrado("Assinatura");
    if (atual.status !== "PENDENTE" || atual.ativadaEm || atual.cobrancas.some(c => c.status === "PAGA" || c.status === "ESTORNADA")) throw revisao();
    if (!atual.operacaoInicial) return null;
    if (atual.operacaoInicial !== "CANCELAMENTO_REVISAO" || !atual.gatewayId?.startsWith("pixrec_") || !atual.cobrancas.length) throw revisao();
    if (await tx.emissaoPixMensal.findFirst({ where: { assinaturaId: id, estado: { in: ["EMITINDO", "INCERTA"] } }, select: { id: true } })) throw revisao();
    await tx.assinatura.update({ where: { id }, data: { operacaoInicial: "MANTENDO" } });
    await auditar(tx, usuarioId, "solicitar_manter_operacao_inicial", "assinatura", id, {});
    return atual;
  });
  if (!a) return { mantida: true };

  try {
    const abertas = a.cobrancas.filter(c => c.status === "PENDENTE" || c.status === "ATRASADA");
    if (abertas.length !== 1) throw revisao();
    for (const c of a.cobrancas) {
      const provedor = await gatewayPorId(c.gatewayId);
      const remota = await provedor.buscarCobrancaAvulsa?.(c.gatewayId);
      if (!remota) throw revisao();
      const confirmada = c.id === abertas[0].id
        ? pagamentoAindaDisponivel(remota, c.gatewayId, c.valorCentavos)
        : cancelamentoSemRecebimento(remota, c.gatewayId, c.valorCentavos);
      if (!confirmada) throw revisao();
    }
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`pix-mensal-assinatura:${id}`}, 0))`;
      const corrente = await tx.assinatura.findUniqueOrThrow({ where: { id }, include: { cobrancas: true } });
      if (corrente.operacaoInicial !== "MANTENDO" || corrente.status !== "PENDENTE" || corrente.ativadaEm ||
        corrente.gatewayId !== a.gatewayId || !cobrancasConferidas(a.cobrancas, corrente.cobrancas, true)) throw revisao();
      await tx.assinatura.update({ where: { id }, data: { operacaoInicial: null } });
      await auditar(tx, usuarioId, "manter_operacao_inicial", "assinatura", id, { cobrancas: a.cobrancas.map(c => c.id) });
    });
    return { mantida: true };
  } catch {
    await db.assinatura.updateMany({ where: { id, operacaoInicial: "MANTENDO" }, data: { operacaoInicial: "CANCELAMENTO_REVISAO" } });
    throw new ErroNegocio("Não foi possível confirmar um Pix válido. Peça à equipe para conferir a situação do pagamento no provedor.", 409, "assinatura_operacao_revisao");
  }
}
