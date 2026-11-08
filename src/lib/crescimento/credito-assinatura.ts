import type { Assinatura, Cobranca, Prisma, ReservaCreditoAssinatura } from "@prisma/client";
import { db } from "@/lib/db";
import { auditar } from "@/lib/auditoria";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import { comoAplicar } from "@/lib/pagamentos/retencao-gateway";
import { aplicarNoGateway, buscarProvaCobrancaCredito, conferirGatewayAntesDoCredito } from "./credito-assinatura-gateway";
import { conferirAssinaturaCredito, conferirProvaCredito, creditosMensalidadeAtivos, diaCredito, revisaoCredito, type ProvaCobrancaCredito } from "./credito-assinatura-regras";
import { ordemDeUso, planoDeUso } from "./saldo";

export type TxCreditoAssinatura = Prisma.TransactionClient;
export type { ProvaCobrancaCredito } from "./credito-assinatura-regras";

const elegiveis = (clienteId: string, agora = new Date()): Prisma.BeneficioWhereInput => ({
  clienteId, status: "DISPONIVEL", reservaCreditoId: null, valorCentavos: { gt: 0 },
  motivo: { in: ["INDICOU", "INDICADO"] }, expiraEm: { gt: agora },
  indicacao: { regra: "ASSINATURA_V2", estornadaEm: null, convertidaEm: { not: null } },
});

async function travar(tx: TxCreditoAssinatura, clienteId: string, assinaturaId: string, vencimento?: string) {
  await tx.$queryRaw`SELECT 1 FROM clientes WHERE id = ${clienteId} FOR UPDATE`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`pix-mensal-assinatura:${assinaturaId}`}, 0))`;
  if (vencimento) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`pix-mensal:${assinaturaId}:${vencimento}`}, 0))`;
}

async function conferirConflitos(tx: TxCreditoAssinatura, a: Assinatura) {
  const [alteracao, cobranca, emissao] = await Promise.all([
    tx.alteracaoPlanoAssinatura.findFirst({ where: { assinaturaId: a.id, estado: { in: ["SOLICITADA", "AGENDADA", "EM_CONFERENCIA"] } }, select: { id: true } }),
    tx.cobranca.findFirst({ where: { assinaturaId: a.id, OR: [{ status: { in: ["PENDENTE", "ATRASADA"] } }, { vencimento: a.proximoVencimento!, status: { not: "CANCELADA" } }] }, select: { id: true } }),
    tx.emissaoPixMensal.findFirst({ where: { assinaturaId: a.id, OR: [{ estado: { in: ["EMITINDO", "INCERTA"] } }, { vencimento: a.proximoVencimento!, estado: "CONFIRMADA" }] }, select: { id: true } }),
  ]);
  if (alteracao || cobranca || emissao) throw revisaoCredito();
}

async function conferirOrigem(tx: TxCreditoAssinatura, reservaId: string, valorEsperado: number) {
  const partes = await tx.beneficio.findMany({ where: { reservaCreditoId: reservaId }, include: { indicacao: true } });
  if (!partes.length || partes.reduce((s, b) => s + b.valorCentavos, 0) !== valorEsperado) throw revisaoCredito();
  for (const b of partes) {
    const fonte = b.indicacao ?? (b.origemBeneficioId ? (await tx.beneficio.findUnique({ where: { id: b.origemBeneficioId }, include: { indicacao: true } }))?.indicacao : null);
    if (b.status !== "USADO" || !Number.isSafeInteger(b.valorCentavos) || b.valorCentavos <= 0 || !["INDICOU", "INDICADO"].includes(b.motivo) || !fonte || fonte.regra !== "ASSINATURA_V2" || !fonte.convertidaEm || fonte.estornadaEm) throw revisaoCredito();
  }
  return partes;
}

function publico(r: ReservaCreditoAssinatura) {
  return { id: r.id, assinaturaId: r.assinaturaId, vencimento: diaCredito(r.vencimento), valorCentavos: r.valorCentavos, estado: r.estado };
}

/** Solicitar dentro da validade separa o crédito para uma única próxima competência. */
export async function reservarCreditoAssinatura(clienteId: string, assinaturaId: string, valorSolicitadoCentavos?: number) {
  if (!creditosMensalidadeAtivos()) throw new ErroNegocio("O uso de crédito na mensalidade ainda não está disponível. Fale com a recepção.", 409, "credito_desativado");
  const antes = await db.assinatura.findUnique({ where: { id: assinaturaId } });
  if (!antes || antes.clienteId !== clienteId) throw naoEncontrado("Assinatura");
  conferirAssinaturaCredito(antes);
  const aplicacao = comoAplicar(antes.gatewayId);
  if (!aplicacao) throw revisaoCredito();
  // Evita API de escrita e nova reserva quando uma tentativa já tem estado persistido.
  const existente = await db.reservaCreditoAssinatura.findUnique({ where: { assinaturaId_vencimento: { assinaturaId, vencimento: antes.proximoVencimento! } } });
  if (existente) return publico(existente);
  if (aplicacao === "gateway") await conferirGatewayAntesDoCredito(antes);
  const resultado = await db.$transaction(async (tx) => {
    await travar(tx, clienteId, assinaturaId, diaCredito(antes.proximoVencimento!));
    const a = await tx.assinatura.findUnique({ where: { id: assinaturaId } });
    if (!a || a.clienteId !== clienteId) throw naoEncontrado("Assinatura");
    const valorMensalidadeCentavos = conferirAssinaturaCredito(a);
    if (a.gatewayId !== antes.gatewayId || a.gatewayClienteId !== antes.gatewayClienteId || a.precoCentavos !== antes.precoCentavos || a.proximoVencimento?.getTime() !== antes.proximoVencimento?.getTime()) throw revisaoCredito();
    const repetida = await tx.reservaCreditoAssinatura.findUnique({ where: { assinaturaId_vencimento: { assinaturaId, vencimento: a.proximoVencimento! } } });
    if (repetida) return { reserva: repetida, nova: false, assinatura: a };
    await conferirConflitos(tx, a);
    const creditos = ordemDeUso(await tx.beneficio.findMany({ where: elegiveis(clienteId), orderBy: { criadoEm: "asc" } }));
    const total = creditos.reduce((s, b) => s + b.valorCentavos, 0);
    if (!total) throw new ErroNegocio("Não há crédito de indicação válido para reservar.", 409, "credito_insuficiente");
    const valor = valorSolicitadoCentavos ?? total;
    // Provedor ainda não comprovou mensalidade integralmente quitada por crédito: sem centavo artificial.
    if (!Number.isSafeInteger(valor) || valor <= 0 || valor > total || valor >= valorMensalidadeCentavos || valorMensalidadeCentavos <= 0) throw revisaoCredito();
    const reserva = await tx.reservaCreditoAssinatura.create({ data: {
      id: `credito-assinatura:${assinaturaId}:${diaCredito(a.proximoVencimento!)}`, assinaturaId,
      vencimento: a.proximoVencimento!, valorCentavos: valor, valorMensalidadeCentavos,
      estado: aplicacao === "gateway" ? "APLICANDO" : "RESERVADA",
    } });
    for (const p of planoDeUso(creditos, valor)) {
      const b = creditos.find((x) => x.id === p.id)!;
      if (p.sobra > 0) {
        await tx.beneficio.update({ where: { id: b.id }, data: { valorCentavos: p.sobra } });
        await tx.beneficio.create({ data: { clienteId, descricao: b.descricao, valorCentavos: p.usa, motivo: b.motivo, expiraEm: b.expiraEm, origemBeneficioId: b.origemBeneficioId ?? b.id, status: "USADO", usadoEm: null, reservaCreditoId: reserva.id } });
      } else {
        await tx.beneficio.update({ where: { id: b.id }, data: { status: "USADO", usadoEm: null, reservaCreditoId: reserva.id } });
      }
    }
    await auditar(tx, null, "reservar_credito_assinatura", "assinatura", assinaturaId, { clienteId, reservaId: reserva.id, valorCentavos: valor, vencimento: diaCredito(reserva.vencimento) });
    return { reserva, nova: true, assinatura: a };
  });
  if (!resultado.nova || aplicacao !== "gateway") return publico(resultado.reserva);
  try {
    const descontoId = await aplicarNoGateway(resultado.assinatura, resultado.reserva);
    return await db.$transaction(async (tx) => {
      await travar(tx, clienteId, assinaturaId, diaCredito(resultado.reserva.vencimento));
      await conferirOrigem(tx, resultado.reserva.id, resultado.reserva.valorCentavos);
      const a = await tx.assinatura.findUniqueOrThrow({ where: { id: assinaturaId } });
      if (conferirAssinaturaCredito(a) !== resultado.reserva.valorMensalidadeCentavos || a.gatewayId !== antes.gatewayId || diaCredito(a.proximoVencimento!) !== diaCredito(resultado.reserva.vencimento)) throw revisaoCredito();
      const atualizada = await tx.reservaCreditoAssinatura.updateMany({ where: { id: resultado.reserva.id, estado: "APLICANDO" }, data: { estado: "CONFIRMADA", gatewayDescontoId: descontoId } });
      if (atualizada.count !== 1) throw revisaoCredito();
      return publico(await tx.reservaCreditoAssinatura.findUniqueOrThrow({ where: { id: resultado.reserva.id } }));
    });
  } catch {
    // Timeout pode esconder desconto aplicado. Não repetir POST, liberar ou estender validade.
    await db.reservaCreditoAssinatura.updateMany({ where: { id: resultado.reserva.id, estado: "APLICANDO" }, data: { estado: "REVISAO" } });
    throw revisaoCredito();
  }
}

/** Chamado sob a mesma trava da emissão Pix, antes de reservar o intento/consultar gateway. */
export async function creditoDoCicloParaPix(tx: TxCreditoAssinatura, assinatura: Assinatura, vencimento: string) {
  const r = await tx.reservaCreditoAssinatura.findUnique({ where: { assinaturaId_vencimento: { assinaturaId: assinatura.id, vencimento: new Date(`${vencimento}T00:00:00Z`) } } });
  if (!r) return null;
  // Uma reserva antiga continua bloqueando emissão insegura mesmo com a flag desligada.
  if (!creditosMensalidadeAtivos() || r.estado !== "RESERVADA" || comoAplicar(assinatura.gatewayId) !== "local" || conferirAssinaturaCredito(assinatura) !== r.valorMensalidadeCentavos || diaCredito(assinatura.proximoVencimento!) !== vencimento) throw revisaoCredito();
  await conferirOrigem(tx, r.id, r.valorCentavos);
  const valorCentavos = r.valorMensalidadeCentavos - r.valorCentavos;
  if (valorCentavos <= 0) throw revisaoCredito();
  return { reservaId: r.id, abatimentoCentavos: r.valorCentavos, valorCentavos };
}

/** Emissão comprovada vincula, pagamento comprovado consome. Falha nunca libera saldo automaticamente. */
export async function confirmarCreditoNaCobranca(cobranca: Cobranca, prova?: ProvaCobrancaCredito) {
  const r = await db.reservaCreditoAssinatura.findUnique({ where: { assinaturaId_vencimento: { assinaturaId: cobranca.assinaturaId, vencimento: cobranca.vencimento } } });
  if (!r) return null;
  const assinatura = await db.assinatura.findUniqueOrThrow({ where: { id: cobranca.assinaturaId } });
  try {
    const p = prova ?? await buscarProvaCobrancaCredito(assinatura, cobranca, r);
    return await db.$transaction(async (tx) => {
      await travar(tx, assinatura.clienteId, assinatura.id, diaCredito(r.vencimento));
      const atual = await tx.reservaCreditoAssinatura.findUniqueOrThrow({ where: { id: r.id } });
      if (!["RESERVADA", "CONFIRMADA", "APLICADA"].includes(atual.estado) || cobranca.status === "CANCELADA" || cobranca.status === "ESTORNADA") throw revisaoCredito();
      const a = await tx.assinatura.findUniqueOrThrow({ where: { id: assinatura.id } });
      conferirProvaCredito(atual, a, cobranca, p);
      if (p.status !== cobranca.status) throw revisaoCredito();
      if (atual.estado === "APLICADA") {
        if (atual.cobrancaId !== cobranca.id || p.status !== "PAGA") throw revisaoCredito();
        return publico(atual);
      }
      await conferirOrigem(tx, atual.id, atual.valorCentavos);
      if (atual.cobrancaId && atual.cobrancaId !== cobranca.id) throw revisaoCredito();
      const estado = p.status === "PAGA" ? "APLICADA" : "CONFIRMADA";
      const mudanca = await tx.reservaCreditoAssinatura.updateMany({ where: { id: atual.id, estado: atual.estado, cobrancaId: atual.cobrancaId }, data: { estado, cobrancaId: cobranca.id } });
      if (mudanca.count !== 1) throw revisaoCredito();
      if (p.status === "PAGA") await tx.beneficio.updateMany({ where: { reservaCreditoId: atual.id, status: "USADO", usadoEm: null }, data: { usadoEm: new Date() } });
      await auditar(tx, null, "conferir_credito_assinatura", "assinatura", assinatura.id, { reservaId: atual.id, cobrancaId: cobranca.id, estado });
      return publico(await tx.reservaCreditoAssinatura.findUniqueOrThrow({ where: { id: atual.id } }));
    });
  } catch {
    await db.reservaCreditoAssinatura.updateMany({ where: { id: r.id, estado: { not: "REVISAO" } }, data: { estado: "REVISAO" } });
    throw revisaoCredito();
  }
}

/** Extrato sem gateway, tokens ou dados de outras pessoas; leitura permitida com flag desligada. */
export async function extratoReservasCredito(clienteId: string) {
  const [reservas, saldo, assinaturas] = await Promise.all([
    db.reservaCreditoAssinatura.findMany({ where: { assinatura: { clienteId } }, orderBy: { criadoEm: "desc" }, take: 30 }),
    db.beneficio.aggregate({ where: elegiveis(clienteId), _sum: { valorCentavos: true } }),
    db.assinatura.findMany({ where: { clienteId, status: "ATIVA" }, select: { id: true, precoCentavos: true, proximoVencimento: true, plano: { select: { nome: true } } } }),
  ]);
  return { ativa: creditosMensalidadeAtivos(), saldoElegivelCentavos: saldo._sum.valorCentavos ?? 0, reservas: reservas.map(publico), assinaturas: assinaturas.map((a) => ({ id: a.id, nome: a.plano.nome, precoCentavos: a.precoCentavos, proximoVencimento: a.proximoVencimento ? diaCredito(a.proximoVencimento) : null })) };
}
