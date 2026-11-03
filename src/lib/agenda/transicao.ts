import type { Prisma } from "@prisma/client";
import { ErroNegocio } from "@/lib/erros";

export const confirmacaoPelaEquipe = () => new ErroNegocio("A equipe precisa conferir a agenda para confirmar este horário. Fale com a barbearia para concluir.", 409, "confirmacao_equipe");

export function checarConfirmacaoAutomatica(cfg: { agendaExternaAtiva?: boolean }) {
  if (cfg.agendaExternaAtiva) throw confirmacaoPelaEquipe();
}

/** Serializa a ativação do modo externo com confirmações que já estejam em andamento. */
export async function checarTransicaoNaReserva(tx: Prisma.TransactionClient) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext('agenda:fonte'))`;
  const cfg = await tx.configuracao.findUnique({ where: { id: 1 }, select: { agendaExternaAtiva: true } });
  if (cfg) checarConfirmacaoAutomatica(cfg);
}

export function contatoParaConfirmacao(numero: string | undefined) {
  const d = numero?.replace(/\D/g, "") ?? "";
  return /^\d{10,15}$/.test(d) ? `https://wa.me/${d}?text=${encodeURIComponent("Olá! Gostaria de confirmar um horário na Black.")}` : null;
}
