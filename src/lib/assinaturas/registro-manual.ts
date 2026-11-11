import type { z } from "zod";
import { configuracao } from "@/lib/agenda/carregar";
import { travarClienteAgenda } from "@/lib/agenda/cliente-identidade";
import { dataLocal, dataParaColuna, instanteLocal, somarDias } from "@/lib/agenda/tempo";
import { auditar } from "@/lib/auditoria";
import { BALCAO, type Sessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { ErroNegocio, naoEncontrado, proibido } from "@/lib/erros";
import { fimDoCicloManual, vencimentoDoRegistro } from "./registro-manual-regras";
import { schemaRegistroManual } from "./schemas";

/** Registra o período pago fora do sistema, sem criar recebimento ou fatura. */
export async function registrarAssinaturaPaga(s: Sessao, entrada: z.infer<typeof schemaRegistroManual>) {
  if (!BALCAO.includes(s.papel)) throw proibido();
  const p = schemaRegistroManual.parse(entrada);
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM usuarios WHERE id = ${s.usuarioId} FOR SHARE`;
    const ator = await tx.usuario.findUnique({ where: { id: s.usuarioId }, select: { ativo: true, papel: true, sessaoVersao: true } });
    if (!ator?.ativo || ator.papel !== s.papel || ator.sessaoVersao !== (s.sessaoVersao ?? 0)) {
      throw new ErroNegocio("Sua sessão mudou. Entre novamente para registrar o pagamento.", 401, "sessao_invalida");
    }
    await travarClienteAgenda(tx, p.clienteId);
    await tx.$queryRaw`SELECT id FROM clientes WHERE id = ${p.clienteId} FOR UPDATE`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`assinatura-cliente:${p.clienteId}`}, 0))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cliente:${p.clienteId}`}))`;
    const { fuso } = await configuracao(tx);
    const hoje = dataLocal(Date.now(), fuso);
    if (p.pagoEm > hoje) throw new ErroNegocio("Informe a data de um pagamento que já aconteceu.", 422, "pagamento_futuro");
    const vencimento = vencimentoDoRegistro(p.pagoEm, p.proximoVencimento);
    if (vencimento <= p.pagoEm) throw new ErroNegocio("O vencimento deve ser posterior ao último pagamento.", 422, "vencimento_invalido");

    const existentes = await tx.assinatura.findMany({
      where: { clienteId: p.clienteId, status: { not: "CANCELADA" } }, take: 2,
    });
    const atual = existentes[0];
    if (existentes.length > 1 || (atual && (
      fimDoCicloManual(atual) === null || atual.planoId !== p.planoId || atual.operacaoInicial || atual.pausadaEm || atual.encerraEm || atual.status === "PENDENTE"
    ))) throw new ErroNegocio("Já existe uma assinatura ou cobrança em andamento. Confira o contrato antes de registrar outro pagamento.", 409, "assinatura_existente");

    const anterior = atual ?? await tx.assinatura.findFirst({
      where: { clienteId: p.clienteId, status: "CANCELADA", ultimoPagamentoManualEm: { not: null } },
      orderBy: { ultimoPagamentoManualEm: "desc" },
      select: { ultimoPagamentoManualEm: true, proximoVencimento: true },
    });
    const pagoAnterior = anterior?.ultimoPagamentoManualEm?.toISOString().slice(0, 10);
    const vencimentoAnterior = anterior?.proximoVencimento?.toISOString().slice(0, 10) ?? null;
    if (atual && pagoAnterior === p.pagoEm && vencimentoAnterior === vencimento && atual.formaPagamento === p.forma) {
      return { id: atual.id, status: vencimento < hoje ? "ATRASADA" as const : atual.status, proximoVencimento: vencimento, novo: false };
    }
    if (pagoAnterior && (p.pagoEm <= pagoAnterior || (vencimentoAnterior && vencimento <= vencimentoAnterior))) {
      throw new ErroNegocio("O pagamento e o vencimento precisam ser posteriores aos já registrados.", 409, "ciclo_manual_anterior");
    }
    if (vencimentoAnterior && hoje <= vencimentoAnterior) {
      throw new ErroNegocio("O ciclo atual ainda está vigente. Registre o próximo após o vencimento para preservar os usos deste período.", 409, "ciclo_manual_vigente");
    }
    if (vencimento < hoje) throw new ErroNegocio("O período informado já venceu. Confira o último pagamento e o vencimento antes de ativar.", 422, "ciclo_manual_vencido");

    await tx.$queryRaw`SELECT id FROM planos WHERE id = ${p.planoId} FOR UPDATE`;
    const plano = await tx.plano.findUnique({ where: { id: p.planoId } });
    if (!plano?.ativo) throw naoEncontrado("Plano ativo");
    if (!atual && !plano.compravel) throw new ErroNegocio("Este plano é somente para consulta. A equipe de gestão precisa conferir o contrato.", 409, "plano_consulta");
    if (!atual && plano.precoCentavos !== p.precoPlanoCentavos) {
      throw new ErroNegocio("O preço de referência mudou. Reabra o formulário e confira o plano.", 409, "plano_alterado");
    }
    const inicio = vencimentoAnterior && p.pagoEm <= vencimentoAnterior ? somarDias(vencimentoAnterior, 1) : p.pagoEm;
    const cicloInicio = new Date(instanteLocal(inicio, 0, fuso));
    const dados = {
      status: "ATIVA" as const,
      formaPagamento: p.forma,
      ultimoPagamentoManualEm: dataParaColuna(p.pagoEm),
      cicloInicio,
      proximoVencimento: dataParaColuna(vencimento),
    };
    const a = atual
      ? await tx.assinatura.update({ where: { id: atual.id }, data: dados })
      : await tx.assinatura.create({ data: {
        ...dados, clienteId: p.clienteId, planoId: p.planoId, precoCentavos: plano.precoCentavos, origem: "PAINEL", ativadaEm: cicloInicio,
      } });
    await tx.listaEsperaPlano.deleteMany({ where: { planoId: p.planoId, clienteId: p.clienteId } });
    await auditar(tx, s.usuarioId, "registrar_plano_ja_pago", "assinatura", a.id, {
      planoId: p.planoId, clienteId: p.clienteId, origem: "DECLARACAO_EQUIPE",
      antes: atual ? { pagoEm: pagoAnterior, vencimento: vencimentoAnterior, forma: atual.formaPagamento, status: atual.status } : null,
      depois: { pagoEm: p.pagoEm, inicio, vencimento, forma: p.forma, status: a.status, vencimentoInformado: !!p.proximoVencimento },
    });
    return { id: a.id, status: a.status, proximoVencimento: vencimento, novo: !atual };
  });
}

export async function marcarCiclosManuaisVencidos() {
  const { fuso } = await configuracao();
  const hoje = dataParaColuna(dataLocal(Date.now(), fuso));
  const r = await db.assinatura.updateMany({
    where: { gatewayId: null, status: "ATIVA", ultimoPagamentoManualEm: { not: null }, proximoVencimento: { lt: hoje } },
    data: { status: "ATRASADA" },
  });
  return r.count;
}
