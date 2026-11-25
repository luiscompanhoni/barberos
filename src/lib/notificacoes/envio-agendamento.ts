import { db } from "@/lib/db";
import { processarPush } from "./envio";

/** Chamar depois do commit. A fila persistida permite recuperar uma falha pelo cron. */
export async function enviarAvisosNovoAgendamento(agendamentoId: string) {
  try {
    const avisos = await db.notificacao.findMany({ where: { chave: `novo-agendamento:${agendamentoId}`, categoria: "EQUIPE" }, select: { id: true } });
    if (avisos.length) await processarPush(new Date(), { notificacaoIds: avisos.map(n => n.id), limite: 50 });
  } catch { console.error("[notificacoes] Falha ao entregar aviso de nova reserva. Fila preservada para a rotina."); }
}
