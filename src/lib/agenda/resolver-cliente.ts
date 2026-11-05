import type { Prisma } from "@prisma/client";
import { ErroNegocio, naoEncontrado } from "@/lib/erros";
import { normalizarTelefone } from "@/lib/telefone";

export async function resolverCliente(tx: Prisma.TransactionClient, c: { id: string } | { telefone: string; nome: string }): Promise<string> {
  if ("id" in c) {
    const existe = await tx.cliente.findUnique({ where: { id: c.id } });
    if (!existe) throw naoEncontrado("Cliente");
    return existe.id;
  }
  const telefone = normalizarTelefone(c.telefone);
  if (!telefone) throw new ErroNegocio("Telefone inválido. Use DDD + número.");
  const nome = c.nome.trim();
  const cli = await tx.cliente.upsert({
    where: { telefone },
    create: { telefone, nome: nome || "Cliente" },
    update: {},
  });
  return cli.id;
}
