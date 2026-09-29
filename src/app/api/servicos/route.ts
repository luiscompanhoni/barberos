import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirSessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { rota } from "@/lib/erros";
import { corpo } from "@/lib/validacao";

export const GET = rota(async () => {
  await exigirSessao();
  const servicos = await db.servico.findMany({
    orderBy: [{ ordem: "asc" }, { nome: "asc" }],
    include: { barbeiros: { select: { barbeiroId: true, duracaoMin: true, precoCentavos: true } } },
  });
  return NextResponse.json(servicos);
});

export const POST = rota(async (req: Request) => {
  await exigirSessao(["DONO"]);
  const b = await corpo(
    req,
    z.object({
      nome: z.string().trim().min(2).max(60),
      duracaoMin: z.number().int().min(5).max(480),
      precoCentavos: z.number().int().min(0).max(10_000_00),
      barbeiroIds: z.array(z.string()).default([]),
    }),
  );
  const s = await db.servico.create({
    data: {
      nome: b.nome,
      duracaoMin: b.duracaoMin,
      precoCentavos: b.precoCentavos,
      barbeiros: { create: b.barbeiroIds.map((barbeiroId) => ({ barbeiroId })) },
    },
  });
  return NextResponse.json(s, { status: 201 });
});
