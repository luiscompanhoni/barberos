import { Prisma } from "@prisma/client";
import type { Sessao } from "@/lib/auth/sessao";
import { auditar } from "@/lib/auditoria";
import { db } from "@/lib/db";
import { ErroNegocio, naoEncontrado, proibido } from "@/lib/erros";
import { chaveEscolhaHistorico, contextoHistorico, revisaoHistorico } from "./consulta";
import { buscarTransacaoHistorica } from "./fonte";
import { backupApto, gatewayHistorico, planejarHistorico } from "./regras";
import { zAplicarHistorico, type AplicarHistorico } from "./schemas";

/** Corrige registros locais. Nao chama gateways de cobranca, devolucao ou notificacao. */
export async function aplicarHistorico(s: Sessao, entrada: AplicarHistorico) {
  if (s.papel !== "DONO") throw proibido();
  const { revisao, backupId, ...p } = zAplicarHistorico.parse(entrada);
  const fonte = await buscarTransacaoHistorica(p.transacaoId);
  try {
    return await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`conciliacao:celcash:${p.transacaoId}`}))`;
      // A mesma trava usada pelo fluxo normal de estornos impede duas devolucoes locais em disputa.
      if (p.cobrancaId) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`estorno:MENSALIDADE:${p.cobrancaId}`}))`;
      const alvo = await tx.assinatura.findUnique({ where: { id: p.assinaturaId }, select: { clienteId: true } });
      if (!alvo) throw naoEncontrado("Assinatura");
      // Ordem fixa; FK impede novas assinaturas/cobrancas durante a verificacao de duplicatas.
      await tx.$queryRaw`SELECT id FROM clientes WHERE id = ${alvo.clienteId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM assinaturas WHERE "clienteId" = ${alvo.clienteId} ORDER BY id FOR UPDATE`;
      await tx.$queryRaw`SELECT c.id FROM cobrancas c JOIN assinaturas a ON a.id = c."assinaturaId" WHERE a."clienteId" = ${alvo.clienteId} ORDER BY c.id FOR UPDATE OF c`;
      await tx.$queryRaw`SELECT id FROM movimentos_externos WHERE fonte = 'CELCASH' AND "transacaoId" = ${p.transacaoId} ORDER BY id FOR UPDATE`;
      const c = await contextoHistorico(tx, fonte, p.assinaturaId);
      const existente = c.vinculos.find((v) => v.transacaoId === p.transacaoId);
      const evidenciaAnterior = existente?.evidencia as Record<string, unknown> | undefined;
      const cobAnterior = c.cobrancas.find((x) => x.id === existente?.cobrancaId);
      if (evidenciaAnterior?.revisao === revisao && evidenciaAnterior.escolha === chaveEscolhaHistorico(p, backupId) && evidenciaAnterior.operacao === p.operacao && cobAnterior?.assinaturaId === p.assinaturaId &&
        (p.operacao === "IMPORTAR" || p.cobrancaId === cobAnterior.id)) {
        return { cobrancaId: cobAnterior.id, vinculoId: existente!.id, repetida: true };
      }
      if (revisaoHistorico(p, c) !== revisao) throw new ErroNegocio("Os dados mudaram desde a prévia. Confira uma nova prévia antes de aplicar.", 409);
      if (c.backup?.id !== backupId || !backupApto(c.backup)) throw new ErroNegocio("Faça um backup com restauração conferida há no máximo duas horas e gere outra prévia.", 409);
      const plano = planejarHistorico(p, c);
      if (plano.bloqueios.length || !plano.recebimento) throw new ErroNegocio(plano.bloqueios.join(" "), 409);
      const cobranca = p.operacao === "IMPORTAR"
        ? await tx.cobranca.create({ data: {
          assinaturaId: p.assinaturaId, gatewayId: gatewayHistorico(fonte.id), valorCentavos: fonte.valorCentavos,
          vencimento: new Date(`${fonte.vencimento}T00:00:00.000Z`), pagaEm: plano.recebimento.data, status: "PAGA",
        } })
        : await tx.cobranca.update({ where: { id: plano.cobranca!.id }, data: { assinaturaId: p.assinaturaId } });
      let pedidoEstornoId: string | undefined;
      if (plano.registrarEstorno && plano.estorno) {
        const pedido = await tx.pedidoEstorno.create({ data: {
          tipo: "MENSALIDADE", referenciaId: cobranca.id, status: "EXECUTADO", meio: "CELCASH", forma: "ONLINE",
          valorCentavos: fonte.valorCentavos, valorOriginalCentavos: fonte.valorCentavos,
          motivo: p.motivo, descricao: `Estorno histórico Celcash #${fonte.id}`, clienteNome: c.assinatura.cliente.nome,
          pedidoPorId: s.usuarioId, decididoPorId: s.usuarioId, decididoEm: new Date(), executadoEm: plano.estorno.data,
          motivoDecisao: "Devolução já realizada, comprovada no extrato e na transação Celcash.",
          gatewayEstornoId: `celcash:extrato:${plano.estorno.id}`,
        } });
        pedidoEstornoId = pedido.id;
        await tx.cobranca.update({ where: { id: cobranca.id }, data: { status: "ESTORNADA" } });
      }
      const evidencia = {
        revisao, escolha: chaveEscolhaHistorico(p, backupId), operacao: p.operacao, motivo: p.motivo, identidade: plano.identidade ? "COMPROVADA" : "CONFIRMADA_PELO_DONO",
        transacaoId: fonte.id, contratoId: fonte.contratoId, statusFonte: fonte.status, valorCentavos: fonte.valorCentavos,
        vencimentoFonte: fonte.vencimento, recebimentoId: plano.recebimento.id, creditoEm: plano.recebimento.data.toISOString(),
        backupId, conferidaEm: new Date().toISOString(),
        estornoMovimentoId: plano.registrarEstorno ? plano.estorno?.id ?? null : null,
        estornoEm: plano.registrarEstorno ? plano.estorno?.data.toISOString() ?? null : null,
      };
      const dados = {
        cobrancaId: cobranca.id, contratoId: fonte.contratoId, recebimentoId: plano.recebimento.id,
        referenciaBackup: backupId, evidencia,
        ...(pedidoEstornoId ? { pedidoEstornoId, estornoMovimentoId: plano.estorno!.id } : {}),
      };
      const vinculo = existente
        ? await tx.vinculoCobrancaExterna.update({ where: { id: existente.id }, data: dados })
        : await tx.vinculoCobrancaExterna.create({ data: { ...dados, fonte: "CELCASH", transacaoId: fonte.id, criadoPorId: s.usuarioId } });
      await auditar(tx, s.usuarioId, "conciliacao_historico", "cobranca", cobranca.id, {
        ...evidencia, vinculoId: vinculo.id, pedidoEstornoId: pedidoEstornoId ?? null,
        antes: plano.cobranca ? { assinaturaId: plano.cobranca.assinaturaId, status: plano.cobranca.status, gatewayId: plano.cobranca.gatewayId,
          valorCentavos: plano.cobranca.valorCentavos, vencimento: plano.cobranca.vencimento.toISOString(), pagaEm: plano.cobranca.pagaEm?.toISOString() ?? null } : null,
        depois: { assinaturaId: p.assinaturaId, status: plano.registrarEstorno ? "ESTORNADA" : cobranca.status, gatewayId: cobranca.gatewayId,
          valorCentavos: cobranca.valorCentavos, vencimento: cobranca.vencimento.toISOString(), pagaEm: cobranca.pagaEm?.toISOString() ?? null },
      });
      return { cobrancaId: cobranca.id, vinculoId: vinculo.id, repetida: false };
    // ReadCommitted enxerga pedidos criados enquanto aguardava a trava do estorno.
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15_000 });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(e.code)) {
      throw new ErroNegocio("Outra operação alterou estes registros. Consulte novamente; nenhuma duplicata foi criada.", 409);
    }
    throw e;
  }
}
