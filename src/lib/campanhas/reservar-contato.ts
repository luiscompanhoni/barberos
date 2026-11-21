import type { Prisma } from "@prisma/client";
import { temperaturaDoCliente } from "@/lib/clientes/segmentos";
import { db } from "@/lib/db";
import { urlSite } from "@/lib/dominios";
import { noAr, premiosExibiveis } from "@/lib/jogos/motor";
import { impedimentoCampanha } from "./contato";
import { campanhaConferida, type LoteAutorizado } from "./lote-autorizado";
import { montarMensagem, textoDaOferta } from "./regras";

export const INTERVALO_CAMPANHAS_MS = 48 * 60 * 60 * 1000;
export const migracaoDoCliente = {
  where: { status: { in: ["ATIVA", "ATRASADA", "PENDENTE"] as ("ATIVA" | "ATRASADA" | "PENDENTE")[] } },
  select: { migracao: { select: { estado: true } } },
};

export const jogoDoLink = {
  select: { tipo: true, ativo: true, inicioEm: true, fimEm: true, soAssinante: true, premios: { where: { ativo: true } } },
} as const;
type JogoDoLink = Prisma.JogoGetPayload<typeof jogoDoLink>;

export function linkDaOferta(token: string | null) {
  return token ? `${urlSite()}/c/r/${token}` : `${urlSite()}/c/agendar`;
}

export async function roletaDisponivel(jogo: JogoDoLink | null, agora: number, tx: Prisma.TransactionClient = db) {
  return !!jogo && jogo.tipo === "ROLETA" && !jogo.soAssinante && noAr(jogo, new Date(agora)) &&
    (await premiosExibiveis(jogo.premios, tx)).length >= 2;
}

export async function impedimentoRoleta(tx: Prisma.TransactionClient, clienteId: string, agora: number, jogo: JogoDoLink | null, token: string | null, oferta: string) {
  const visita = await tx.agendamento.aggregate({ where: { clienteId, status: "CONCLUIDO" }, _max: { inicio: true } });
  const temperatura = temperaturaDoCliente(visita._max.inicio?.getTime() ?? null, agora);
  if (temperatura !== "frio" && temperatura !== "muitoFrio") return null;
  const primeiroLink = oferta.match(/(?:https?:\/\/[^\s<>()]+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\/[^\s<>()]*)?)/i)?.[0].replace(/[.!?,]+$/, "");
  return token && primeiroLink === linkDaOferta(token) && await roletaDisponivel(jogo, agora, tx)
    ? null : "Para cliente frio ou muito frio, o primeiro link da oferta precisa abrir uma roleta ativa com jogada disponível.";
}

/** Duas campanhas não reservam contato com a mesma pessoa na mesma janela. */
export async function reservarContatoCampanha(
  { id, campanhaId, clienteId, token }: { id: string; campanhaId: string; clienteId: string; token: string | null },
  agora: number, barbearia: string, autorizado: LoteAutorizado | null,
) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`campanha:${campanhaId}`}))`;
    const campanha = await tx.campanha.findUnique({ where: { id: campanhaId }, include: { jogo: jogoDoLink } });
    if (campanha?.status !== "ATIVA" || (autorizado && !campanhaConferida(campanha, autorizado))) return false;
    await tx.$queryRaw`SELECT 1 FROM clientes WHERE id = ${clienteId} FOR UPDATE`;
    const cliente = await tx.cliente.findUnique({ where: { id: clienteId }, select: { nome: true, telefone: true, aceitaMensagens: true, excluidoEm: true, conversa: { select: { estado: true, recusaAutomaticas: true } }, assinaturas: migracaoDoCliente } });
    if (!cliente) return false;
    const marcou = await tx.agendamento.count({ where: { clienteId, status: { in: ["MARCADO", "CONFIRMADO"] }, inicio: { gt: new Date(agora) } } });
    const ofertaTexto = montarMensagem(textoDaOferta(campanha.mensagem), { nome: cliente.nome, barbearia, link: linkDaOferta(token) });
    const pular = impedimentoCampanha(cliente, marcou > 0) ??
      await impedimentoRoleta(tx, clienteId, agora, campanha.jogo, token, ofertaTexto);
    if (!pular && await tx.campanhaEnvio.findFirst({ where: { clienteId, status: "ENVIADO", enviadoEm: { gte: new Date(agora - INTERVALO_CAMPANHAS_MS) } }, select: { id: true } })) return false;
    const ok = await tx.campanhaEnvio.updateMany({
      where: { id, campanhaId, clienteId, status: "FILA" },
      data: pular ? { status: "PULADO", erro: pular } : { status: "ENVIADO", enviadoEm: new Date(agora), aberturaIniciadaEm: new Date(agora), ofertaTexto },
    });
    return ok.count > 0 && !pular ? { nome: cliente.nome, telefone: cliente.telefone } : false;
  });
}
