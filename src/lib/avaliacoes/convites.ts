import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { primeiraVisitaElegivel } from "./regras";

type Tx = Prisma.TransactionClient;

/** Mesmo lock dos jogos: convite e ficha de atendimento não podem se antecipar entre si. */
export async function garantirConvite(tx: Tx, clienteId: string, agora = new Date()) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`jogos:${clienteId}`}))`;
  const existente = await tx.conviteAvaliacao.findUnique({ where: { clienteId } });
  if (existente) return existente;
  const cfg = await tx.avaliacaoConfig.findUnique({ where: { id: 1 } });
  if (!cfg?.ativo || !cfg.ativaDesde) return null;
  // Consultar todo o histórico impede transformar cliente recorrente em primeira visita.
  const primeira = await tx.agendamento.findFirst({
    where: { clienteId, status: "CONCLUIDO", adicionalDeId: null },
    orderBy: [{ inicio: "asc" }, { id: "asc" }], select: { id: true, barbeiroId: true, fim: true },
  });
  if (!primeira || !primeiraVisitaElegivel({ ...cfg, primeiraFim: primeira.fim, agora })) return null;
  return tx.conviteAvaliacao.create({ data: {
    clienteId, agendamentoId: primeira.id, barbeiroId: primeira.barbeiroId,
    jogoId: cfg.jogoId, recompensaValidadeDias: cfg.recompensaValidadeDias,
    expiraEm: new Date(primeira.fim.getTime() + cfg.validadeDias * 86_400_000),
  } });
}

export async function assegurarConvitePrimeiraVisita(clienteId: string, agora = new Date()) {
  return db.$transaction(tx => garantirConvite(tx, clienteId, agora));
}

/** Retira somente o evento que ganha ficha pela avaliação, inclusive adicionais da mesma visita. */
export async function atendimentoCondicionadoAvaliacao(tx: Tx, clienteId: string, jogoId: string, agora = new Date()) {
  const convite = await garantirConvite(tx, clienteId, agora);
  return convite?.jogoId === jogoId ? convite.agendamentoId : null;
}

export async function conviteDoCliente(clienteId: string) {
  const convite = await assegurarConvitePrimeiraVisita(clienteId);
  if (!convite) return null;
  const [resposta, jogo, barbeiro] = await Promise.all([
    db.avaliacaoCliente.findUnique({ where: { conviteId: convite.id }, select: { nota: true } }),
    convite.jogoId ? db.jogo.findUnique({ where: { id: convite.jogoId }, select: { nome: true } }) : null,
    db.barbeiro.findUnique({ where: { id: convite.barbeiroId }, select: { nome: true } }),
  ]);
  return { id: convite.id, expiraEm: convite.expiraEm.toISOString(), respondida: !!resposta,
    expirada: !resposta && convite.expiraEm <= new Date(), barbeiro: barbeiro?.nome ?? "seu profissional",
    recompensa: convite.jogoId ? { jogoId: convite.jogoId, nome: jogo?.nome ?? "Jogo", validadeDias: convite.recompensaValidadeDias } : null };
}
