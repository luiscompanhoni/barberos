import { Prisma, type Configuracao } from "@prisma/client";
import { enviarAutomacao } from "@/lib/automacoes/enviar";
import { db } from "@/lib/db";
import { naFila } from "@/lib/whatsapp/fila-conversa";
import { temJanela24h } from "@/lib/whatsapp/canal";
import { atrasoNudgeRoleta, HORA, JANELA_JORNADA_ROLETA, NUDGE_ROLETA, POS_ROLETA, UPSELL_ROLETA, upsellRoletaAtivo } from "./jornada-roleta";
import { canalDaTrilhaRoleta, comContatoRoleta, notificarRoleta, type DestinoRoleta } from "./jornada-roleta-envios";

type Jornada = DestinoRoleta & { jogadaId: string };
type Opcoes = { clienteIds?: string[] };
const MAX_POR_RODADA = 30;
const POS_ANTECEDENCIA_MS = HORA / 2;
const POS_LIMITE_MS = 12 * HORA;

function semAvanco(agora: Date) {
  return Prisma.sql`
    NOT EXISTS (
      SELECT 1 FROM agendamentos a
      WHERE a."clienteId" = j."clienteId" AND a."adicionalDeId" IS NULL AND (
        (a.fim > ${agora} AND a.status IN ('MARCADO', 'CONFIRMADO', 'CHEGOU', 'EM_ATENDIMENTO'))
        OR (a.inicio >= j."ganhouEm" AND a.status IN ('CHEGOU', 'EM_ATENDIMENTO', 'CONCLUIDO'))
      )
    )
    AND NOT EXISTS (
      SELECT 1 FROM pedidos_agendamento p WHERE p."clienteId" = j."clienteId" AND p.status = 'PENDENTE'
    )
    AND EXISTS (
      SELECT 1 FROM premios_ganhos p LEFT JOIN beneficios b ON b.id = p."beneficioId"
      WHERE p."jogadaId" = j."jogadaId" AND (p."expiraEm" IS NULL OR p."expiraEm" > ${agora})
        AND (p.status = 'DISPONIVEL' OR
          (p.tipo = 'CREDITO' AND p.status = 'UTILIZADO' AND b.status = 'DISPONIVEL'
            AND b."valorCentavos" > 0 AND (b."expiraEm" IS NULL OR b."expiraEm" > ${agora})))
    )`;
}

function semNudgeRecente(agora: number) {
  return Prisma.sql`
    NOT EXISTS (
      SELECT 1 FROM jornadas_roleta anterior WHERE anterior."clienteId" = j."clienteId"
        AND anterior."jogadaId" <> j."jogadaId" AND anterior."nudgeTentadoEm" >= ${new Date(agora - JANELA_JORNADA_ROLETA)}
    )`;
}

function clientesLimitados(opcoes: Opcoes) {
  return opcoes.clienteIds
    ? Prisma.sql`AND j."clienteId" IN (${Prisma.join(opcoes.clienteIds)})` : Prisma.empty;
}

/** Medição independente do envio. A recusa de mensagens só impede o contato. */
export async function registrarAbandonosRoleta(agora: number, opcoes: Opcoes) {
  if (opcoes.clienteIds?.length === 0) return;
  await db.$executeRaw`
    UPDATE jornadas_roleta j SET "semContinuidadeEm" = ${new Date(agora)}
    WHERE j."semContinuidadeEm" IS NULL AND j."agendouEm" IS NULL
      AND j."ganhouEm" > ${new Date(agora - JANELA_JORNADA_ROLETA)}
      AND j."ganhouEm" <= ${new Date(agora - atrasoNudgeRoleta())}
      ${clientesLimitados(opcoes)} AND ${semAvanco(new Date(agora))}`;
}

async function nudgeAindaDevido(tx: Prisma.TransactionClient, j: Jornada, agora: number) {
  const devidos = await tx.$queryRaw<{ jogadaId: string }[]>`
    SELECT j."jogadaId" FROM jornadas_roleta j
    WHERE j."jogadaId" = ${j.jogadaId} AND j."agendouEm" IS NULL
      AND ${semAvanco(new Date(agora))} AND ${semNudgeRecente(agora)}`;
  return devidos.length === 1;
}

async function upsellAindaDevido(tx: Prisma.TransactionClient, j: Jornada, agora: number) {
  if (!upsellRoletaAtivo()) return false;
  const futura = await tx.agendamento.findFirst({ where: {
    clienteId: j.id, inicio: { gt: new Date(agora) }, adicionalDeId: null, status: { in: ["MARCADO", "CONFIRMADO"] },
  }, select: { id: true } });
  const pedido = await tx.pedidoAgendamento.findFirst({ where: { clienteId: j.id, status: "PENDENTE" }, select: { id: true } });
  const vigente = await tx.jornadaRoleta.findFirst({ where: { jogadaId: j.jogadaId, posEnviadoEm: { not: null },
    agendamento: { status: "CONCLUIDO" } }, select: { jogadaId: true } });
  return !futura && !pedido && !!vigente;
}

/** A reserva fica confirmada no banco antes do transporte, inclusive se a resposta do canal se perder. */
function enviarToque(j: Jornada, cfg: Configuracao, agora: number, tipo: "NUDGE" | "UPSELL") {
  const nudge = tipo === "NUDGE";
  const tentativa = nudge ? "nudgeTentadoEm" : "upsellTentadoEm";
  const registro = nudge ? "nudgeEnviadoEm" : "upsellEnviadoEm";
  const texto = nudge ? NUDGE_ROLETA : UPSELL_ROLETA;
  const devido = nudge ? nudgeAindaDevido : upsellAindaDevido;
  return naFila(j.telefone, async () => {
    const reservado = await comContatoRoleta(j, cfg, agora, false, async tx => {
      if (!await devido(tx, j, agora)) return false;
      const r = await tx.jornadaRoleta.updateMany({
        where: { jogadaId: j.jogadaId, [tentativa]: null }, data: { [tentativa]: new Date() },
      });
      return r.count === 1;
    });
    if (!reservado) return false;
    return comContatoRoleta(j, cfg, agora, false, async tx => {
      if (!await devido(tx, j, agora)) return false;
      const r = await notificarRoleta(j.telefone, texto);
      if (!r.ok) return false;
      const m = await tx.mensagem.findUniqueOrThrow({ where: { id: r.mensagemId }, select: { criadoEm: true } });
      await tx.jornadaRoleta.update({ where: { jogadaId: j.jogadaId }, data: { [registro]: m.criadoEm } });
      return true;
    });
  });
}

export async function rodarNudgesRoleta(agora: number, cfg: Configuracao, opcoes: Opcoes) {
  if (!canalDaTrilhaRoleta(cfg, agora) || opcoes.clienteIds?.length === 0) return 0;
  const intervalo = temJanela24h()
    ? Prisma.sql`AND c."ultimaEntradaEm" > ${new Date(agora - 24 * HORA)} AND c."ultimaEntradaEm" <= ${new Date(agora)}`
    : Prisma.empty;
  const candidatas = await db.$queryRaw<Jornada[]>`
    SELECT j."jogadaId", v.id, v.telefone FROM jornadas_roleta j
    JOIN clientes v ON v.id = j."clienteId"
    LEFT JOIN conversas c ON c."clienteId" = v.id
    WHERE j."ganhouEm" > ${new Date(agora - JANELA_JORNADA_ROLETA)}
      AND j."semContinuidadeEm" IS NOT NULL AND j."nudgeTentadoEm" IS NULL AND j."agendouEm" IS NULL
      AND v."aceitaMensagens" AND v."excluidoEm" IS NULL
      AND (c.id IS NULL OR (c.estado = 'BOT' AND NOT c."recusaAutomaticas" AND c.telefone = v.telefone))
      ${intervalo} ${clientesLimitados(opcoes)}
      AND ${semAvanco(new Date(agora))} AND ${semNudgeRecente(agora)}
    ORDER BY j."semContinuidadeEm", j."jogadaId"
    LIMIT ${MAX_POR_RODADA}`;
  let enviados = 0;
  for (const j of candidatas) if (await enviarToque(j, cfg, agora, "NUDGE")) enviados++;
  return enviados;
}

function enviarPos(j: Jornada & { agendamentoId: string }, cfg: Configuracao, agora: number) {
  return naFila(j.telefone, () => comContatoRoleta(j, cfg, agora, true, async tx => {
    const vigente = await tx.jornadaRoleta.findFirst({ where: { jogadaId: j.jogadaId, agendamentoId: j.agendamentoId,
      posEnviadoEm: null, agendamento: { status: "CONCLUIDO" } }, select: { jogadaId: true } });
    if (!vigente) return false;
    if (await tx.automacaoEnviada.findFirst({ where: {
      tipo: "POS_ATENDIMENTO", clienteId: j.id, agendamentoId: j.agendamentoId,
    }, select: { id: true } })) return false;
    const chave = `${j.id}:${new Date(agora).toISOString().slice(0, 10)}`;
    const resultado = await enviarAutomacao({ tipo: "POS_ATENDIMENTO", chave, clienteId: j.id,
      agendamentoId: j.agendamentoId, telefone: j.telefone, texto: POS_ROLETA }, () => notificarRoleta(j.telefone, POS_ROLETA, true));
    if (!resultado) return false;
    await tx.jornadaRoleta.update({ where: { jogadaId: j.jogadaId }, data: { posEnviadoEm: new Date() } });
    return true;
  }));
}

export async function rodarPosRoleta(agora: number, cfg: Configuracao, opcoes: Opcoes) {
  const contagem = { pos: 0, upsell: 0 };
  if (!canalDaTrilhaRoleta(cfg, agora)) return contagem;
  const jornadas = await db.jornadaRoleta.findMany({ where: {
    ...(opcoes.clienteIds ? { clienteId: { in: opcoes.clienteIds } } : {}),
    cliente: { aceitaMensagens: true, excluidoEm: null, OR: [
      { conversa: null }, { conversa: { estado: "BOT", recusaAutomaticas: false } },
    ] }, agendamento: { status: "CONCLUIDO" },
    concluiuEm: { gt: new Date(agora - POS_LIMITE_MS), lte: new Date(agora - POS_ANTECEDENCIA_MS) },
    ...(upsellRoletaAtivo() ? { OR: [{ posEnviadoEm: null }, { upsellTentadoEm: null }] } : { posEnviadoEm: null }),
  }, orderBy: { concluiuEm: "asc" }, take: MAX_POR_RODADA, select: {
    jogadaId: true, agendamentoId: true, posEnviadoEm: true, upsellTentadoEm: true,
    cliente: { select: { id: true, telefone: true } },
  } });
  for (const j of jornadas) {
    if (!j.agendamentoId) continue;
    const dados = { ...j.cliente, jogadaId: j.jogadaId, agendamentoId: j.agendamentoId };
    const enviou = !j.posEnviadoEm && await enviarPos(dados, cfg, agora);
    if (enviou) contagem.pos++;
    if ((enviou || j.posEnviadoEm) && !j.upsellTentadoEm && upsellRoletaAtivo() &&
      await enviarToque(dados, cfg, agora, "UPSELL")) contagem.upsell++;
  }
  return contagem;
}
