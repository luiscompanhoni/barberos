import type { Agendamento } from "@prisma/client";
import { configuracao } from "@/lib/agenda/carregar";
import { descreverData } from "@/lib/bot/detalhes-agenda";
import { avisoAoReservar } from "@/lib/automacoes/regras";
import { auditar } from "@/lib/auditoria";
import { naFila } from "@/lib/whatsapp/fila-conversa";
import { temJanela24h } from "@/lib/whatsapp/canal";
import { canalConviteAtivo } from "./canal";
import { ehJornadaLeonel } from "./link";
import { db } from "@/lib/db";
import { confirmarPeloCliente } from "@/lib/agenda/cliente";
import { enviarNaConversa } from "@/lib/whatsapp/conversas";
import { dataLocal, minParaHhmm, minutosLocal } from "@/lib/agenda/tempo";

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


type ReservaJornada = Pick<Agendamento, "clienteId" | "criadoEm">;

async function jornadaDaReserva(conversaId: string, ag: ReservaJornada) {
  if (!await canalConviteAtivo()) return null;
  const j = await db.jornadaConviteApp.findUnique({ where: { conversaId }, select: {
    token: true, clienteId: true, parouEm: true, link: { select: { criadoEm: true, erro: true } },
  } });
  return j && ehJornadaLeonel(j.token) && j.clienteId === ag.clienteId && !j.parouEm && j.link && !j.link.erro &&
    +ag.criadoEm >= +j.link.criadoEm && +ag.criadoEm <= +j.link.criadoEm + 30 * 86_400_000 ? j : null;
}

export async function jornadaAceitaLembrete(conversaId: string, ag: ReservaJornada) {
  return await jornadaDaReserva(conversaId, ag) !== null;
}

/** Reserva feita pelo app durante o convite. A confirmação pelo chat já é dada pelo próprio Leonel. */
export async function avisarReservaPeloApp(agendamentoId: string, clienteId: string) {
  const contato = await db.conversa.findUnique({ where: { clienteId }, select: { id: true, telefone: true, estado: true, recusaAutomaticas: true } });
  if (!contato || contato.estado !== "BOT" || contato.recusaAutomaticas || temJanela24h()) return;
  await naFila(contato.telefone, async () => {
    const ag = await db.agendamento.findFirst({
      where: { id: agendamentoId, clienteId, origem: "SITE", status: { in: ["MARCADO", "CONFIRMADO"] }, inicio: { gt: new Date() },
        cliente: { telefone: contato.telefone, aceitaMensagens: true, excluidoEm: null } },
      include: { barbeiro: { select: { nome: true } }, servico: { select: { nome: true } } },
    });
    if (!ag || !await jornadaDaReserva(contato.id, ag)) return;
    const cfg = await configuracao();
    const hora = minParaHhmm(minutosLocal(+ag.inicio, cfg.fuso));
    const dia = descreverData(dataLocal(+ag.inicio, cfg.fuso));
    const lembrar = avisoAoReservar({ inicio: +ag.inicio, criadoEm: +ag.criadoEm, status: ag.status }, Date.now(), 90, true);
    const mensagem = `Tá marcado! ${ag.servico.nome} com ${ag.barbeiro.nome}, ${dia}, às ${hora}.` +
      (lembrar ? " Vou te mandar um lembrete cerca de uma hora e meia antes pra confirmar tua presença." : "");
    const reservado = await db.$transaction(async tx => {
      const acao = "reservar_confirmacao_app_whatsapp";
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`whatsapp:confirmacao:${ag.id}`}, 0))`;
      if (await tx.auditoria.findFirst({ where: { acao, entidadeId: ag.id }, select: { id: true } })) return false;
      const atual = await tx.jornadaConviteApp.updateMany({
        where: { conversaId: contato.id, parouEm: null, conversa: { estado: "BOT", recusaAutomaticas: false } },
        data: { proximaEm: null },
      });
      if (!atual.count) return false;
      await auditar(tx, null, acao, "agendamento", ag.id);
      return true;
    });
    if (!reservado) return;
    await enviarNaConversa(contato.id, mensagem, "BOT", { conviteIndividual: true, pararSeHumano: true });
  });
}
