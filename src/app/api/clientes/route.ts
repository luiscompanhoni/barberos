import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirSessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { rota } from "@/lib/erros";
import { parametros } from "@/lib/validacao";

/** Busca por nome ou telefone (formulario de encaixe reconhece cliente antigo). */
export const GET = rota(async (req: Request) => {
  await exigirSessao();
  const { busca } = parametros(req, z.object({ busca: z.string().trim().min(2).max(60) }));
  const digitos = busca.replace(/\D/g, "");
  const clientes = await db.cliente.findMany({
    where: {
      OR: [
        { nome: { contains: busca, mode: "insensitive" } },
        ...(digitos.length >= 4 ? [{ telefone: { contains: digitos } }] : []),
      ],
    },
    select: { id: true, nome: true, telefone: true, observacoes: true },
    take: 8,
    orderBy: { nome: "asc" },
  });
  return NextResponse.json(clientes);
});
