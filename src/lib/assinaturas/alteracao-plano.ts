import type { OrigemAgendamento, Plano, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { auditar } from "@/lib/auditoria";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import { configuracao } from "@/lib/agenda/carregar";
import { dataLocal, instanteLocal } from "@/lib/agenda/tempo";
import { gatewayPorId } from "@/lib/pagamentos/gateway";

const ESTADOS_ABERTOS = ["SOLICITADA", "AGENDADA", "EM_CONFERENCIA"];
const incluirPlano = { servicos: { orderBy: { servicoId: "asc" as const } }, barbeiros: { orderBy: { barbeiroId: "asc" as const } } };
const dia = (d: Date) => d.toISOString().slice(0, 10);
type PlanoCompleto = Plano & { servicos: { servicoId: string; usosPorCiclo: number | null }[]; barbeiros: { barbeiroId: string }[] };
function condicoes(p: PlanoCompleto): Prisma.InputJsonObject {
  return { nome: p.nome, precoCentavos: p.precoCentavos, diasSemana: p.diasSemana, intervaloMinDias: p.intervaloMinDias,
    descontoExtrasPct: p.descontoExtrasPct, formasPagamento: p.formasPagamento, maxAgendamentosAbertos: p.maxAgendamentosAbertos,
    servicos: p.servicos.map(s => ({ id: s.servicoId, usos: s.usosPorCiclo })), barbeiros: p.barbeiros.map(b => b.barbeiroId) };
}

export const classificacaoTroca = (atual: number, novo: number) => novo > atual ? "UPGRADE" : novo < atual ? "DOWNGRADE" : "TROCA";
export function condicoesIguais(a: unknown, b: unknown): boolean {
  const canonica = (v: unknown): string => v === null || typeof v !== "object" ? JSON.stringify(v) : Array.isArray(v)
    ? `[${v.map(canonica).join(",")}]` : `{${Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => `${JSON.stringify(k)}:${canonica(x)}`).join(",")}}`;
  return canonica(a) === canonica(b);
}

export async function alteracaoAtual(assinaturaId: string) {
  const p = await db.alteracaoPlanoAssinatura.findFirst({ where: { assinaturaId, estado: { in: ESTADOS_ABERTOS } }, orderBy: { criadaEm: "desc" } });
  if (!p) return null;
  const nome = (p.condicoes as { nome?: string } | null)?.nome ?? "Plano escolhido";
  return { id: p.id, planoId: p.planoDestinoId, nome, precoCentavos: p.precoNovoCentavos, efetivaEm: dia(p.efetivaEm), estado: p.estado,
    tipo: classificacaoTroca(p.precoAnteriorCentavos, p.precoNovoCentavos) };
}

/** A escolha registra intenção para a renovação; não muda benefícios nem preço do período pago. */
export async function solicitarAlteracaoPlano(p: { assinaturaId: string; planoId: string; origem: OrigemAgendamento; usuarioId: string }) {
  const hoje = dataLocal(Date.now(), (await configuracao()).fuso);
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`pix-mensal-assinatura:${p.assinaturaId}`}, 0))`;
    const a = await tx.assinatura.findUnique({ where: { id: p.assinaturaId } });
    if (!a) throw naoEncontrado("Assinatura");
    if (a.status !== "ATIVA" || a.pausadaEm || a.encerraEm || a.operacaoInicial || !a.proximoVencimento || dia(a.proximoVencimento) <= hoje) {
      throw new ErroNegocio("A assinatura precisa estar ativa, sem pendências e com a próxima renovação definida para solicitar a troca.", 409, "troca_indisponivel");
    }
    if (a.planoId === p.planoId) throw new ErroNegocio("Esse já é o plano atual.", 409);
    const existente = await tx.alteracaoPlanoAssinatura.findFirst({ where: { assinaturaId: a.id, estado: { in: ESTADOS_ABERTOS } } });
    if (existente) {
      if (existente.planoDestinoId === p.planoId) return existente;
      throw new ErroNegocio("Já existe uma troca solicitada. Cancele o pedido anterior para escolher outro plano.", 409, "troca_existente");
    }
    const novo = await tx.plano.findUnique({ where: { id: p.planoId }, include: incluirPlano });
    if (!novo || !novo.ativo || !novo.compravel || ((p.origem === "SITE" || p.origem === "BOT") && !novo.visivel)
      || (novo.vendaSomenteEquipe && p.origem !== "RECEPCAO" && p.origem !== "PAINEL")) throw naoEncontrado("Plano disponível");
    if (!novo.formasPagamento.includes(a.formaPagamento)) throw new ErroNegocio("O novo plano não aceita a forma de pagamento atual. Confira com a recepção.", 409);
    const pedido = await tx.alteracaoPlanoAssinatura.create({ data: {
      assinaturaId: a.id, planoAnteriorId: a.planoId, planoDestinoId: novo.id,
      precoAnteriorCentavos: a.precoCentavos, precoNovoCentavos: novo.precoCentavos,
      efetivaEm: a.proximoVencimento, origem: p.origem, usuarioId: p.usuarioId, condicoes: condicoes(novo),
    } });
    await auditar(tx, p.usuarioId, "solicitar_troca_plano", "assinatura", a.id, { pedidoId: pedido.id, planoId: novo.id, efetivaEm: dia(pedido.efetivaEm) });
    return pedido;
  });
}

export async function cancelarAlteracaoPlano(assinaturaId: string, usuarioId: string) {
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`pix-mensal-assinatura:${assinaturaId}`}, 0))`;
    const pedido = await tx.alteracaoPlanoAssinatura.findFirst({ where: { assinaturaId, estado: { in: ESTADOS_ABERTOS } } });
    if (!pedido) return { cancelada: false };
    if (pedido.estado !== "SOLICITADA") throw new ErroNegocio("A troca já está em conferência. Fale com a equipe antes de cancelar.", 409);
    await tx.alteracaoPlanoAssinatura.update({ where: { id: pedido.id }, data: { estado: "CANCELADA" } });
    await auditar(tx, usuarioId, "cancelar_troca_plano", "assinatura", assinaturaId, { pedidoId: pedido.id });
    return { cancelada: true };
  });
}

/** Confere a cobrança de renovação existente. Não cria, altera ou estorna pagamentos no provedor. */
async function conferirRenovacaoExterna(gatewayId: string, valor: number, vencimento: string) {
  const g = await gatewayPorId(gatewayId);
  const cobrancas = await g.cobrancasDaAssinatura(gatewayId);
  const renovacao = cobrancas.find(c => c.assinaturaGatewayId === gatewayId && c.vencimentoConfirmado === true && c.vencimento === vencimento && c.valorCentavos === valor && c.status === "PAGA");
  const prova = renovacao && await g.buscarCobrancaAvulsa?.(renovacao.id);
  if (!prova || prova.id !== renovacao?.id || prova.status !== "PAGA" || prova.valorCentavos !== valor || prova.moeda !== "BRL" || prova.liquidadoCentavos !== valor) {
    throw new ErroNegocio("A renovação no novo valor ainda não foi comprovada no provedor. Confira a alteração do contrato e o pagamento antes de aplicar o plano.", 409, "troca_em_conferencia");
  }
}

/** Recepção aplica após conferência, no início do novo período, preservando o histórico. */
export async function aplicarAlteracaoPlano(assinaturaId: string, usuarioId: string) {
  const pedido = await db.alteracaoPlanoAssinatura.findFirst({ where: { assinaturaId, estado: { in: ESTADOS_ABERTOS } } });
  if (!pedido) throw naoEncontrado("Pedido de alteração");
  const a = await db.assinatura.findUniqueOrThrow({ where: { id: assinaturaId } });
  const fuso = (await configuracao()).fuso;
  const hoje = dataLocal(Date.now(), fuso);
  if (dia(pedido.efetivaEm) > hoje) throw new ErroNegocio(`A troca fica disponível a partir de ${dia(pedido.efetivaEm).split("-").reverse().join("/")}. O período atual permanece no plano contratado.`, 409);
  const local = !!a.gatewayId?.startsWith("pixrec_");
  if (!local) {
    if (!a.gatewayId) throw new ErroNegocio("Assinatura sem contrato conferível. Solicite revisão da equipe.", 409);
    await conferirRenovacaoExterna(a.gatewayId, pedido.precoNovoCentavos, dia(pedido.efetivaEm));
  }
  return db.$transaction(async tx => {
    // A agenda trava barbeiro → cliente → cadeira. Aqui não se adquire barbeiro/cadeira.
    // Espera reservas em voo antes de conferir futuros e alterar as regras do cliente.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cliente:${a.clienteId}`}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`pix-mensal-assinatura:${assinaturaId}`}, 0))`;
    await tx.$queryRaw`SELECT id FROM planos WHERE id = ${pedido.planoDestinoId} FOR UPDATE`;
    const [corrente, atual, novo] = await Promise.all([
      tx.assinatura.findUniqueOrThrow({ where: { id: assinaturaId } }),
      tx.alteracaoPlanoAssinatura.findUniqueOrThrow({ where: { id: pedido.id } }),
      tx.plano.findUnique({ where: { id: pedido.planoDestinoId }, include: incluirPlano }),
    ]);
    if (!ESTADOS_ABERTOS.includes(atual.estado) || corrente.clienteId !== a.clienteId || corrente.status !== "ATIVA" || corrente.planoId !== pedido.planoAnteriorId || corrente.precoCentavos !== pedido.precoAnteriorCentavos || corrente.gatewayId !== a.gatewayId || corrente.pausadaEm || corrente.encerraEm || corrente.operacaoInicial) throw new ErroNegocio("A assinatura mudou. Atualize e confira novamente.", 409);
    const cicloEsperado = local ? corrente.proximoVencimento : corrente.cicloInicio;
    if (!cicloEsperado || dia(cicloEsperado) !== dia(pedido.efetivaEm)) throw new ErroNegocio("O ciclo da assinatura mudou ou ainda não foi conciliado. Confira a renovação antes de aplicar este pedido.", 409, "troca_em_conferencia");
    if (!novo || !novo.ativo || !novo.compravel || (novo.vendaSomenteEquipe && atual.origem !== "RECEPCAO" && atual.origem !== "PAINEL") || !novo.formasPagamento.includes(corrente.formaPagamento) || !condicoesIguais(condicoes(novo), pedido.condicoes)) throw new ErroNegocio("As condições do novo plano mudaram. Cancele este pedido e faça uma nova escolha.", 409);
    if (novo.vagas !== null && await tx.assinatura.count({ where: { planoId: novo.id, status: { in: ["ATIVA", "ATRASADA", "PENDENTE"] } } }) >= novo.vagas) throw new ErroNegocio("O plano ficou sem vagas. A troca ainda não foi aplicada.", 409);
    if (await tx.agendamento.findFirst({ where: { assinaturaId, inicio: { gte: new Date(instanteLocal(dia(pedido.efetivaEm), 0, fuso)) }, status: { in: ["MARCADO", "CONFIRMADO"] } }, select: { id: true } })) throw new ErroNegocio("Existem horários futuros vinculados ao plano anterior. Confira esses horários antes de aplicar a troca.", 409);
    if (local && (await tx.cobranca.findFirst({ where: { assinaturaId, vencimento: { gte: pedido.efetivaEm }, status: { not: "CANCELADA" } }, select: { id: true } }) || await tx.emissaoPixMensal.findFirst({ where: { assinaturaId, vencimento: { gte: pedido.efetivaEm } }, select: { id: true } }))) throw new ErroNegocio("A renovação Pix já tem uma emissão. Confira a cobrança antes de alterar o valor.", 409);
    await tx.assinatura.update({ where: { id: assinaturaId }, data: { planoId: novo.id, precoCentavos: pedido.precoNovoCentavos, descontoRetencaoPct: null, descontoRetencaoAte: null } });
    await tx.alteracaoPlanoAssinatura.update({ where: { id: pedido.id }, data: { estado: "APLICADA", aplicadaEm: new Date(), comprovante: local ? "Pix local sem emissão de renovação" : "Renovação confirmada no provedor" } });
    await auditar(tx, usuarioId, "aplicar_troca_plano", "assinatura", assinaturaId, { pedidoId: pedido.id, planoAnteriorId: pedido.planoAnteriorId, planoDestinoId: novo.id, precoCentavos: pedido.precoNovoCentavos });
    return { aplicada: true };
  });
}
