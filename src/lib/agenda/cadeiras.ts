import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { auditar } from "@/lib/auditoria";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import type { Sessao } from "@/lib/auth/sessao";
import { STATUS_ATIVOS } from "./carregar";
import type { Intervalo } from "./disponibilidade";

type Cliente = typeof db | Prisma.TransactionClient;

export async function ocupacaoCadeira(cadeiraId: string | null, int: Intervalo, c: Cliente = db, ignorarId?: string) {
  if (!cadeiraId) return [];
  const cadeira = await c.cadeira.findUnique({ where: { id: cadeiraId } });
  if (!cadeira?.ativa) throw new ErroNegocio("A cadeira selecionada está indisponível.");
  return c.agendamento.findMany({ where: {
    cadeiraId, adicionalDeId: null, status: { in: [...STATUS_ATIVOS] },
    inicio: { lt: new Date(int.fim) }, fim: { gt: new Date(int.inicio) },
    ...(ignorarId ? { id: { not: ignorarId } } : {}),
  }, select: { inicio: true, fim: true } });
}

export async function validarCadeira(tx: Prisma.TransactionClient, cadeiraId: string | null, int: Intervalo, ignorarId?: string, intervaloMin = 0) {
  if (!cadeiraId) return;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cadeira:${cadeiraId}`}))`;
  const folga = intervaloMin * 60_000;
  const ocupados = await ocupacaoCadeira(cadeiraId, { inicio: int.inicio - folga, fim: int.fim + folga }, tx, ignorarId);
  if (ocupados.length) throw new ErroNegocio("A cadeira já está ocupada neste intervalo. Escolha outra cadeira ou horário.", 409, "conflito_cadeira");
}

export async function listarCadeiras() {
  return db.cadeira.findMany({ orderBy: { nome: "asc" }, include: { barbeiros: { select: { id: true, nome: true } } } });
}

export async function salvarCadeira(s: Sessao, dados: { id?: string; nome: string; ativa: boolean }) {
  if (s.papel !== "DONO") throw new ErroNegocio("Somente o dono configura cadeiras.", 403);
  return db.$transaction(async tx => {
    const anterior = dados.id ? await tx.cadeira.findUnique({ where: { id: dados.id } }) : null;
    if (dados.id && !anterior) throw naoEncontrado("Cadeira");
    if (dados.id) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cadeira:${dados.id}`}))`;
    if (!dados.ativa && dados.id && await tx.agendamento.count({ where: { cadeiraId: dados.id, status: { in: ["MARCADO", "CONFIRMADO", "CHEGOU", "EM_ATENDIMENTO"] }, fim: { gt: new Date() } } })) {
      throw new ErroNegocio("Transfira os atendimentos futuros antes de desativar esta cadeira.", 409);
    }
    const d = { nome: dados.nome, ativa: dados.ativa };
    const cadeira = dados.id ? await tx.cadeira.update({ where: { id: dados.id }, data: d }) : await tx.cadeira.create({ data: d });
    if (!dados.ativa) await tx.barbeiro.updateMany({ where: { cadeiraId: cadeira.id }, data: { cadeiraId: null } });
    await auditar(tx, s.usuarioId, "cadeira_configurar", "cadeira", cadeira.id, { antes: anterior ? { nome: anterior.nome, ativa: anterior.ativa } : null, depois: d });
    return cadeira;
  });
}
