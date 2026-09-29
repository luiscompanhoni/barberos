import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirSessao } from "@/lib/auth/sessao";
import { configuracao } from "@/lib/agenda/carregar";
import { db } from "@/lib/db";
import { rota } from "@/lib/erros";
import { corpo } from "@/lib/validacao";

export const GET = rota(async () => {
  await exigirSessao(["DONO"]);
  return NextResponse.json(await configuracao());
});

/** Dados da barbearia e regras de agendamento (valem para bot, site e recepcao). */
export const PATCH = rota(async (req: Request) => {
  await exigirSessao(["DONO"]);
  const b = await corpo(
    req,
    z.object({
      nomeBarbearia: z.string().trim().min(2).max(80).optional(),
      endereco: z.string().trim().max(200).nullable().optional(),
      granularidadeMin: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(20), z.literal(30)]).optional(),
      antecedenciaMinimaMin: z.number().int().min(0).max(24 * 60).optional(),
      janelaAgendamentoDias: z.number().int().min(1).max(120).optional(),
      intervaloEntreClientes: z.number().int().min(0).max(60).optional(),
      prazoCancelamentoMin: z.number().int().min(0).max(72 * 60).optional(),
      maxAgendamentosCliente: z.number().int().min(1).max(10).optional(),
      botAtivo: z.boolean().optional(),
    }),
  );
  await configuracao(); // garante a linha
  return NextResponse.json(await db.configuracao.update({ where: { id: 1 }, data: b }));
});
