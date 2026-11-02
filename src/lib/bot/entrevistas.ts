/** Fluxo determinístico. Não importa modelo de IA nem transportes de envio. */
import { estadoPiloto } from "@/lib/whatsapp/piloto";
import { permitePiloto } from "@/lib/whatsapp/piloto-regras";
import { db } from "@/lib/db";
import { auditar } from "@/lib/auditoria";
import { zAcaoEntrevista } from "@/lib/recrutamento/entrevistas-regras";
import { normalizarTelefone } from "@/lib/telefone";
import { ErroNegocio } from "@/lib/erros";
import { agirEntrevista, porTokenEntrevista, travarAgenda } from "@/lib/recrutamento/entrevistas";
import { tokenEntrevista } from "@/lib/recrutamento/entrevistas-token";
import { instanteLocal } from "@/lib/agenda/tempo";
import { FUSO_ENTREVISTA, rotuloEntrevista, type AcaoEntrevista } from "@/lib/recrutamento/entrevistas-regras";
export const inicioBotEntrevista = (texto: string) => /^ENTREVISTA ([A-Za-z0-9_-]{43})$/i.exec(texto.trim());
export const contemConviteEntrevista = (texto: string) => /(?:ENTREVISTA\s+[A-Za-z0-9_-]{43}|\/entrevistas#[^\s]+)/i.test(texto);
export const comandoReservadoEntrevista = (texto: string) => /^(?:HORARIOS$|ESCOLHER |CONFIRMAR |CANCELAR ENTREVISTA |SAIR ENTREVISTA$)/i.test(texto.trim());
export function registroSeguroEntrevista(texto: string) { return contemConviteEntrevista(texto) ? "[Convite de entrevista apresentado pelo candidato]" : texto; }
export function comandoEntrevista(texto: string): AcaoEntrevista | null {
  if (/^HORARIOS$/i.test(texto.trim())) return { acao: "CONSULTAR" };
  const escolha = /^ESCOLHER (\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2}) (\d+)$/i.exec(texto.trim());
  if (escolha) {
    const h = Number(escolha[2]), m = Number(escolha[3]); if (h > 23 || m > 59) return null;
    try { return { acao: "ESCOLHER", inicio: new Date(instanteLocal(escolha[1], h * 60 + m, FUSO_ENTREVISTA)).toISOString(), versao: Number(escolha[4]) }; } catch { return null; }
  }
  const confirmacao = /^CONFIRMAR (\d+)$/i.exec(texto.trim());
  if (confirmacao) return { acao: "CONFIRMAR", versao: Number(confirmacao[1]) };
  const cancelamento = /^CANCELAR ENTREVISTA (\d+)$/i.exec(texto.trim());
  return cancelamento ? { acao: "CANCELAR", versao: Number(cancelamento[1]) } : null;
}
type Vista = Awaited<ReturnType<typeof agirEntrevista>>;
export function mensagemEntrevista(v: Vista) {
  if (v.estado === "CANCELADA") return "Entrevista cancelada. Para outro convite, fale com o dono da Black.";
  if (v.estado === "CONFIRMADA" && v.inicio) return `Entrevista presencial confirmada: ${rotuloEntrevista(v.inicio, v.duracaoMin)}. Local: ${v.local}. Para cancelar, responda CANCELAR ENTREVISTA ${v.versao}.`;
  if (v.estado === "AGUARDA_CONFIRMACAO" && v.propostaInicio) return `Confira antes de confirmar: ${rotuloEntrevista(v.propostaInicio, v.duracaoMin)}. Presencial em ${v.local}. O horário ainda não está reservado. Responda CONFIRMAR ${v.versao} em até 10 minutos, ou HORARIOS para escolher novamente.`;
  if (!v.horarios.length) return "Não há horários disponíveis nas próximas quatro semanas. Fale com o dono da Black.";
  const formato = new Intl.DateTimeFormat("sv-SE", { timeZone: FUSO_ENTREVISTA, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  return `Entrevistas presenciais às segundas, 14h–16h, duração ${v.duracaoMin} minutos. Local: ${v.local}. Escolha uma opção enviando o comando completo:\n${v.horarios.map(i => `ESCOLHER ${formato.format(new Date(i)).replace(",", "")} ${v.versao}`).join("\n")}\nA reserva só será feita após sua confirmação. Para sair deste atendimento: SAIR ENTREVISTA.`;
}
export async function processarBotEntrevista(ctx: { conversaId: string; telefone: string }, texto: string, agora?: number): Promise<{ tratado: boolean; resposta: string | null }> {
  const piloto = await estadoPiloto();
  const autorizadoPiloto = piloto?.ativo && permitePiloto(piloto, ctx.telefone, "ENTREVISTA_PILOTO", agora);
  if (piloto?.ativo && !autorizadoPiloto) return { tratado: true, resposta: null };
  if (autorizadoPiloto && /^INICIAR ENTREVISTA$/i.test(texto.trim()) && piloto.conviteChave) {
    const [id, geracao] = piloto.conviteChave.split(":");
    const convite = await db.entrevistaRecrutamento.findUnique({ where: { id } });
    if (!convite || String(convite.geracao) !== geracao || convite.donoId !== piloto.usuarioId) return { tratado: true, resposta: "Convite de teste indisponível. Peça ao dono para conferir o piloto." };
    texto = `ENTREVISTA ${tokenEntrevista(convite)}`;
  }
  const inicio = inicioBotEntrevista(texto);
  // Desligado por padrão: nem consulta banco, envia ou chama IA.
  if (!autorizadoPiloto && process.env.RECRUTAMENTO_ENTREVISTAS_WHATSAPP_ATIVO !== "true") return { tratado: contemConviteEntrevista(texto) || comandoReservadoEntrevista(texto), resposta: null };
  try {
    return await db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'entrevista-conversa:'} || ${ctx.conversaId}, 0))`;
      let e = inicio ? await porTokenEntrevista(tx, inicio[1], agora ?? Date.now()) : await tx.entrevistaRecrutamento.findUnique({ where: { conversaId: ctx.conversaId } });
      if (!e) return { tratado: contemConviteEntrevista(texto) || comandoReservadoEntrevista(texto), resposta: null };
      if (autorizadoPiloto && (e.donoId !== piloto.usuarioId || `${e.id}:${e.geracao}` !== piloto.conviteChave)) return { tratado: true, resposta: "Use INICIAR ENTREVISTA para abrir somente o convite deste teste." };
      await travarAgenda(tx, e.donoId);
      const c = await tx.candidaturaRecrutamento.findUniqueOrThrow({ where: { id: e.candidaturaId }, select: { candidato: { select: { telefone: true } } } });
      if (c.candidato.telefone !== normalizarTelefone(ctx.telefone)) throw new ErroNegocio("Não foi possível usar este convite nesta conversa. Contate a Black.", 403);
      if (/^SAIR ENTREVISTA$/i.test(texto.trim())) {
        const atual = await tx.entrevistaRecrutamento.findUniqueOrThrow({ where: { id: e.id } });
        if (atual.conversaId !== ctx.conversaId) return { tratado: true, resposta: "Este atendimento de entrevista já foi encerrado." };
        await tx.entrevistaRecrutamento.update({ where: { id: e.id }, data: { conversaId: null } });
        await auditar(tx, null, "recrutamento.entrevista.sair_bot", "EntrevistaRecrutamento", e.id, {});
        return { tratado: true, resposta: "Atendimento de entrevista encerrado. Isso não cancela uma entrevista já confirmada." };
      }
      e = await porTokenEntrevista(tx, inicio?.[1] ?? tokenEntrevista(e), agora ?? Date.now());
      // Não procura nem funde candidatos por telefone: exige convite e contato desta candidatura.
      if (inicio) {
        const atual = await tx.entrevistaRecrutamento.findUniqueOrThrow({ where: { id: e.id } });
        if (atual.tokenHash !== e.tokenHash || atual.estado === "CANCELADA") throw new ErroNegocio("Convite indisponível. Peça um novo link à Black.", 404);
        await tx.entrevistaRecrutamento.updateMany({ where: { conversaId: ctx.conversaId }, data: { conversaId: null } });
        e = await tx.entrevistaRecrutamento.update({ where: { id: e.id, tokenHash: e.tokenHash }, data: { conversaId: ctx.conversaId } });
        await auditar(tx, null, "recrutamento.entrevista.vincular_bot", "EntrevistaRecrutamento", e.id, {});
      }
      const acao = inicio ? { acao: "CONSULTAR" as const } : comandoEntrevista(texto);
      if (!acao || !zAcaoEntrevista.safeParse(acao).success) return { tratado: true, resposta: "Para consultar opções: HORARIOS. Use o comando de escolha recebido e depois CONFIRMAR com o código informado. Para encerrar este atendimento: SAIR ENTREVISTA." };
      const v = await agirEntrevista(tx, e, acao, "WHATSAPP", agora);
      return { tratado: true, resposta: mensagemEntrevista(v) };
    }, { timeout: 10_000 });
  } catch (err) {
    if (err instanceof ErroNegocio) return { tratado: true, resposta: err.message };
    throw err;
  }
}
