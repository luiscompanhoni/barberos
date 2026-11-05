import { Prisma } from "@prisma/client";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import { normalizarTelefone } from "@/lib/telefone";

export type TitularAgenda = { usuarioId: string; sessaoVersao: number };

/** Antes de pedido/barbeiro/quota/cadeira. A exclusão participa da mesma trava. */
export async function travarClienteAgenda(tx: Prisma.TransactionClient, clienteId: string, titular?: TitularAgenda) {
  if (titular) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`auth-usuario:${titular.usuarioId}`}))`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cliente-ciclo:${clienteId}`}))`;
  const c = await tx.cliente.findUnique({ where: { id: clienteId } });
  if (!c || c.excluidoEm) throw naoEncontrado("Cliente ativo");
  if (titular) {
    const u = await tx.usuario.findUnique({ where: { id: titular.usuarioId } });
    if (!u?.ativo || u.papel !== "CLIENTE" || c.usuarioId !== u.id || u.sessaoVersao !== titular.sessaoVersao) {
      throw new ErroNegocio("Sua sessão mudou. Entre novamente para agendar.", 401, "sessao_invalida");
    }
  }
  return c.id;
}

export async function resolverClienteAgenda(tx: Prisma.TransactionClient, entrada: { id: string } | { telefone: string; nome: string }, titular?: TitularAgenda) {
  if ("id" in entrada) return travarClienteAgenda(tx, entrada.id, titular);
  if (titular) throw new ErroNegocio("O cadastro da sessão precisa ser informado.", 401, "sessao_invalida");
  const telefone = normalizarTelefone(entrada.telefone);
  if (!telefone) throw new ErroNegocio("Telefone inválido. Use DDD + número.");
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cliente-ciclo-telefone:${telefone}`}))`;
  const existente = await tx.cliente.findUnique({ where: { telefone }, select: { id: true } });
  if (existente) return travarClienteAgenda(tx, existente.id);
  try {
    // Não usar upsert: se outro cadastro surgiu, ele precisa ser relido sob sua
    // própria trava. O conflito reverte a reserva, sem inverter row → lifecycle.
    const criado = await tx.cliente.create({ data: { telefone, nome: entrada.nome.trim() || "Cliente" } });
    return travarClienteAgenda(tx, criado.id);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new ErroNegocio("O cadastro mudou. Atualize e tente agendar novamente.", 409, "cliente_alterado");
    throw e;
  }
}
