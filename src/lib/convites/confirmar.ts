import { db } from "@/lib/db";
import { confirmarPeloCliente } from "@/lib/agenda/cliente";
import { enviarNaConversa } from "@/lib/whatsapp/conversas";
import { minParaHhmm, minutosLocal } from "@/lib/agenda/tempo";

export async function confirmarLembreteConvite(conversaId: string, clienteId: string, texto: string, fuso: string) {
  if (!/^\s*(sim|confirmo|confirmado|vou sim)\s*[.!]*\s*$/i.test(texto)) return false;
  const j = await db.jornadaConviteApp.findUnique({ where: { conversaId } });
  if (!j?.lembreteAgendamentoId || !j.lembreteInicio || j.clienteId !== clienteId || j.parouEm) return false;
  const ultima = await db.mensagem.findFirst({ where: { conversaId, autor: { in: ["EQUIPE", "SISTEMA", "BOT"] }, erro: null }, orderBy: { criadoEm: "desc" } });
  if (ultima?.id !== j.lembreteMensagemId) return false;
  const reserva = await db.agendamento.findUnique({ where: { id: j.lembreteAgendamentoId } });
  if (!reserva || reserva.clienteId !== clienteId || +reserva.inicio !== +j.lembreteInicio || +reserva.inicio <= Date.now() || !["MARCADO","CONFIRMADO"].includes(reserva.status)) return false;
  const confirmado = await confirmarPeloCliente(clienteId, reserva.id, j.lembreteInicio);
  await enviarNaConversa(conversaId, `Presença confirmada pro teu horário das ${minParaHhmm(minutosLocal(confirmado.inicio, fuso))}. Até lá! 💈`, "BOT", { respostaAtendimento: true, pararSeHumano: true });
  return true;
}
