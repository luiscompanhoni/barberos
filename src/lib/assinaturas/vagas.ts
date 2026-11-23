import type { Plano, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { planoBaseDezembroEmHomologacao } from "@/lib/oferta-dezembro/config";

const PENDENTE_SEGURA_VAGA_MS = 3 * 86_400_000;

/** No plano-base da oferta, preserva também a vaga de links antigos ainda pagáveis. */
export async function vagasRestantes(plano: Pick<Plano, "id" | "vagas">, c: Prisma.TransactionClient = db, agora = new Date()) {
  if (plano.vagas === null) return null;
  const planoDaOferta = planoBaseDezembroEmHomologacao() === plano.id;
  const cortePendencias = planoDaOferta ? undefined : { gt: new Date(+agora - PENDENTE_SEGURA_VAGA_MS) };
  const ocupadas = await c.assinatura.count({
    where: {
      planoId: plano.id,
      OR: [
        { status: { in: ["ATIVA", "ATRASADA"] } },
        { status: "PENDENTE", ...(cortePendencias ? { criadaEm: cortePendencias } : {}) },
      ],
    },
  });
  return Math.max(0, plano.vagas - ocupadas);
}
