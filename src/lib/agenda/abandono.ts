import { db } from "@/lib/db";
import { ErroNegocio } from "@/lib/erros";
import { travarClienteAgenda } from "@/lib/agenda/cliente-identidade";
import { travarPreferencia } from "@/lib/whatsapp/preferencia";
import { auditar } from "@/lib/auditoria";
import { ATRASO_LEMBRETE_MS, VALIDADE_LEMBRETE_MS, lembreteAgendamentoDevido } from "./abandono-regras";

/** O cliente precisa pedir esta ajuda no próprio agendamento; preferência geral não basta. */
export async function registrarAtividadeAgendamento(clienteId: string, agora = new Date(), usuarioId: string | null = null) {
  if (process.env.LEMBRETE_ABANDONO_PREVIA !== "true") throw new ErroNegocio("A prévia do lembrete não está disponível.", 404, "indisponivel");
  return db.$transaction(async tx => {
    await travarClienteAgenda(tx, clienteId);
    const cliente = await tx.cliente.findUniqueOrThrow({ where: { id: clienteId }, select: { telefone: true } });
    await travarPreferencia(tx, cliente.telefone);
    const preferencia = await tx.cliente.findUniqueOrThrow({ where: { id: clienteId }, select: {
      aceitaMensagens: true, excluidoEm: true, conversa: { select: { recusaAutomaticas: true } },
    } });
    if (preferencia.excluidoEm || !preferencia.aceitaMensagens || preferencia.conversa?.recusaAutomaticas) {
      throw new ErroNegocio("Este número não recebe mensagens automáticas. Ajuste sua preferência antes de pedir o lembrete.", 422, "mensagens_recusadas");
    }
    const anterior = await tx.lembreteAgendamento.findUnique({ where: { clienteId } });
    if (anterior && !anterior.canceladoEm && +agora >= +anterior.ultimaAcaoEm &&
        +agora - +anterior.ultimaAcaoEm <= VALIDADE_LEMBRETE_MS) {
      await tx.lembreteAgendamento.update({ where: { clienteId }, data: { ultimaAcaoEm: agora } });
    } else {
      await tx.lembreteAgendamento.upsert({ where: { clienteId }, create: {
        clienteId, consentiuEm: agora, ultimaAcaoEm: agora,
      }, update: { consentiuEm: agora, ultimaAcaoEm: agora, canceladoEm: null } });
      await auditar(tx, usuarioId, "consentir", "lembrete_agendamento", clienteId, { consentiuEm: agora.toISOString() });
    }
    await tx.$executeRaw`UPDATE jornadas_convite_app SET "proximaEm"=GREATEST(${agora}::timestamptz+interval '2 hours',"ultimaRetomadaEm"+interval '24 hours')
      WHERE "clienteId"=${clienteId} AND "agendaEm" IS NOT NULL AND "linkId" IS NOT NULL AND "parouEm" IS NULL AND retomadas<3
        AND ("ultimaRetomadaEm" IS NULL OR "ultimaRetomadaEm" <= ${agora}::timestamptz-interval '7 days' OR "ultimaRetomadaEm" < "agendaEm")
        AND "inicioEm" >= ${agora}::timestamptz-interval '14 days'`;
    return { ativo: true };
  });
}

export async function cancelarLembreteAgendamento(clienteId: string, agora = new Date(), usuarioId: string | null = null) {
  return db.$transaction(async tx => {
    await travarClienteAgenda(tx, clienteId);
    const r = await tx.lembreteAgendamento.updateMany({ where: { clienteId, canceladoEm: null }, data: { canceladoEm: agora } });
    if (r.count) await tx.jornadaConviteApp.updateMany({ where: { clienteId, agendaEm: { not: null } }, data: { proximaEm: null } });
    if (r.count) await auditar(tx, usuarioId, "revogar", "lembrete_agendamento", clienteId, { canceladoEm: agora.toISOString() });
    return { ativo: false };
  });
}

export async function estadoLembreteAgendamento(clienteId: string) {
  const r = await db.lembreteAgendamento.findUnique({ where: { clienteId }, include: {
    cliente: { select: { aceitaMensagens: true, excluidoEm: true, conversa: { select: { recusaAutomaticas: true } } } },
  } });
  const idade = r ? Date.now() - +r.ultimaAcaoEm : Infinity;
  return { ativo: !!r && !r.canceladoEm && r.cliente.aceitaMensagens && !r.cliente.excluidoEm &&
    !r.cliente.conversa?.recusaAutomaticas && idade >= 0 && idade <= VALIDADE_LEMBRETE_MS };
}

/** Prévia para homologação: nenhum envio é feito por esta função. */
export async function candidatosLembreteAgendamento(agora = new Date()) {
  const registros = await db.lembreteAgendamento.findMany({ where: {
    canceladoEm: null,
    ultimaAcaoEm: { gte: new Date(+agora - VALIDADE_LEMBRETE_MS), lte: new Date(+agora - ATRASO_LEMBRETE_MS) },
    cliente: { aceitaMensagens: true, excluidoEm: null },
  }, take: 50, orderBy: { ultimaAcaoEm: "asc" }, select: {
    clienteId: true, consentiuEm: true, ultimaAcaoEm: true, canceladoEm: true,
    cliente: { select: { conversa: { select: { recusaAutomaticas: true } } } },
  } });
  const elegiveis: string[] = [];
  for (const r of registros) {
    if (r.cliente.conversa?.recusaAutomaticas || !lembreteAgendamentoDevido(r, +agora)) continue;
    const agendou = await db.agendamento.count({ where: { clienteId: r.clienteId, OR: [
      { criadoEm: { gte: r.consentiuEm }, origem: "SITE" },
      { inicio: { gt: agora }, status: { in: ["MARCADO", "CONFIRMADO"] } },
    ] } });
    if (!agendou) elegiveis.push(r.clienteId);
  }
  return elegiveis;
}
