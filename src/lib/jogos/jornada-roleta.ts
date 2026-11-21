import type { Agendamento, Conversa, Jogada, Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export const HORA = 3_600_000;
export const JANELA_JORNADA_ROLETA = 14 * 24 * HORA;
export const NUDGE_ROLETA = "Ô irmão, tudo bem? Vi que tu não deu continuidade depois da roleta. Quer uma mão pra marcar?";
export const POS_ROLETA = "Valeu por vir na Black! Quando quiser marcar o próximo corte, é só chamar aqui. 💈";
export const UPSELL_ROLETA = "Quer já deixar teu próximo corte marcado? Se quiser, te ajudo a ver um horário.";

export function lembreteVesperaRoleta(p: { nome: string; quando: string; servico: string; barbeiro: string; barbearia: string }) {
  const primeiro = p.nome.trim().split(/\s+/)[0];
  return `${primeiro ? `Oi, ${primeiro}!` : "Oi!"} Passando pra lembrar: ${p.quando} tu tem ${p.servico} com ${p.barbeiro} na ${p.barbearia}. ` +
    "Responde *SIM* pra confirmar ou me avisa se precisar remarcar.";
}

export const acompanhamentoRoletaAtivo = () => process.env.WHATSAPP_ROLETA_ACOMPANHAMENTO_ATIVO === "true";
export const upsellRoletaAtivo = () => acompanhamentoRoletaAtivo() && process.env.WHATSAPP_ROLETA_UPSELL_ATIVO === "true";

export function atrasoNudgeRoleta() {
  const horas = Number(process.env.WHATSAPP_ROLETA_NUDGE_HORAS);
  return Number.isInteger(horas) && horas >= 1 && horas <= 168 ? horas * HORA : 4 * HORA;
}

export async function registrarGiroRoleta(tx: Prisma.TransactionClient, j: Pick<Jogada, "id" | "tipo" | "clienteId" | "criadoEm" | "vitoria">) {
  if (j.tipo !== "ROLETA") return;
  await tx.jornadaRoleta.create({ data: {
    jogadaId: j.id, clienteId: j.clienteId, girouEm: j.criadoEm, ganhouEm: j.vitoria ? j.criadoEm : null,
  } });
}

/** Encaixes passados e adicionais não entram no funil. A transação da agenda já trava o cliente. */
export async function vincularAgendamentoRoleta(
  tx: Prisma.TransactionClient, a: Pick<Agendamento, "id" | "clienteId" | "inicio" | "criadoEm" | "status" | "adicionalDeId">, premioId?: string,
) {
  if (a.adicionalDeId || a.status !== "MARCADO" || a.inicio <= a.criadoEm) return;
  if (premioId) {
    const premio = await tx.premioGanho.findFirst({ where: { id: premioId, agendamentoId: a.id, clienteId: a.clienteId },
      select: { jogadaId: true } });
    if (!premio) return;
    const j = await tx.jornadaRoleta.findUnique({ where: { jogadaId: premio.jogadaId } });
    if (!j?.ganhouEm || j.ganhouEm > a.criadoEm || j.compareceuEm) return;
    await tx.jornadaRoleta.updateMany({ where: { jogadaId: j.jogadaId, compareceuEm: null,
      OR: [{ agendamentoId: null }, { agendamento: { status: { in: ["CANCELADO", "FALTOU"] } } },
        { agendamento: { premiosGanhos: { none: { jogadaId: j.jogadaId } } } }] },
      data: { agendamentoId: a.id, agendouEm: a.criadoEm, lembreteEnviadoEm: null } });
    return;
  }
  const candidatas = await tx.jornadaRoleta.findMany({ where: {
    clienteId: a.clienteId, ganhouEm: { gt: new Date(+a.criadoEm - JANELA_JORNADA_ROLETA), lte: a.criadoEm },
  }, take: 2, select: { jogadaId: true, agendouEm: true } });
  if (candidatas.length !== 1 || candidatas[0].agendouEm) return;
  await tx.jornadaRoleta.updateMany({ where: { jogadaId: candidatas[0].jogadaId, agendouEm: null, agendamentoId: null },
    data: { agendamentoId: a.id, agendouEm: a.criadoEm } });
}

export async function registrarComparecimentoRoleta(
  tx: Prisma.TransactionClient, a: Pick<Agendamento, "id" | "status" | "atualizadoEm" | "adicionalDeId">,
) {
  if (a.adicionalDeId || !["CHEGOU", "EM_ATENDIMENTO", "CONCLUIDO"].includes(a.status)) return;
  await tx.jornadaRoleta.updateMany({ where: { agendamentoId: a.id, compareceuEm: null }, data: { compareceuEm: a.atualizadoEm } });
  if (a.status === "CONCLUIDO") {
    await tx.jornadaRoleta.updateMany({ where: { agendamentoId: a.id, concluiuEm: null }, data: { concluiuEm: a.atualizadoEm } });
  }
}

export async function registrarEnvioRoleta(
  agendamentoId: string, campo: "lembreteEnviadoEm" | "posEnviadoEm", agora: number, tx: Prisma.TransactionClient = db,
) {
  await tx.jornadaRoleta.updateMany({ where: { agendamentoId, [campo]: null }, data: { [campo]: new Date(agora) } });
}

const normalizar = (texto: string) => texto.trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "")
  .replace(/[.!]+$/g, "").replace(/\s+/g, " ");

/** Executar depois de registrar entrada; a chave do webhook já eliminou duplicatas. */
export async function registrarEntradaJornadaRoleta(
  c: Pick<Conversa, "id" | "clienteId" | "ultimaEntradaEm" | "recusaAutomaticas">, texto: string | null, optOut: boolean,
): Promise<{ tipo: "NUDGE" | "UPSELL"; jogadaId: string } | null> {
  if (!c.clienteId || !c.ultimaEntradaEm || c.recusaAutomaticas || optOut) return null;
  const ate = c.ultimaEntradaEm;
  const aviso = await db.mensagem.findFirst({ where: {
    conversaId: c.id, autor: { in: ["SISTEMA", "BOT", "EQUIPE"] }, erro: null,
    criadoEm: { lte: ate, gte: new Date(+ate - JANELA_JORNADA_ROLETA) },
  }, orderBy: [{ criadoEm: "desc" }, { id: "desc" }], select: { autor: true, texto: true, criadoEm: true } });
  if (aviso?.autor !== "SISTEMA") return null;
  const upsell = aviso.texto === UPSELL_ROLETA;
  if (!upsell && aviso.texto !== NUDGE_ROLETA) return null;
  const aceitou = /^(?:sim(?:,? (?:quero|pode marcar))?|pode (?:ser|marcar)|quero(?: marcar| deixar o proximo marcado)?)$/;
  if (upsell && (!texto || !aceitou.test(normalizar(texto)))) return null;
  const campoEnvio = upsell ? "upsellEnviadoEm" : "nudgeEnviadoEm";
  const campoEntrada = upsell ? "upsellAceitoEm" : "respondeuEm";
  const j = await db.jornadaRoleta.findFirst({ where: {
    clienteId: c.clienteId, [campoEnvio]: aviso.criadoEm, [campoEntrada]: null,
  }, select: { jogadaId: true } });
  if (!j) return null;
  const registro = await db.jornadaRoleta.updateMany({
    where: { jogadaId: j.jogadaId, [campoEntrada]: null }, data: { [campoEntrada]: ate },
  });
  return registro.count ? { tipo: upsell ? "UPSELL" : "NUDGE", jogadaId: j.jogadaId } : null;
}
