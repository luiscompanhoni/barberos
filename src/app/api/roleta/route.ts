import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirSessao } from "@/lib/auth/sessao";
import { rota } from "@/lib/erros";
import { painelRoleta, salvarRoleta } from "@/lib/roleta/servico";
import { corpo } from "@/lib/validacao";

export const dynamic = "force-dynamic";

/** Configuracao, premios (com a chance de cada um), brindes a entregar e ultimos giros. */
export const GET = rota(async () => {
  await exigirSessao(["DONO", "RECEPCAO"]);
  return NextResponse.json(await painelRoleta());
});

const zPremio = z.object({
  id: z.string().optional(),
  rotulo: z.string().trim().min(1).max(24),
  tipo: z.enum(["CREDITO", "BRINDE", "NADA"]),
  valorCentavos: z.number().int().min(0).max(1_000_000),
  peso: z.number().int().min(0).max(100_000),
  cor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  ativo: z.boolean(),
  limiteMensal: z.number().int().min(0).max(100_000).nullable(),
  custoCentavos: z.number().int().min(0).max(1_000_000).optional(),
});

/** So o dono configura. */
export const PUT = rota(async (req: Request) => {
  const s = await exigirSessao(["DONO"]);
  const b = await corpo(req, z.object({
    config: z.object({
      ativa: z.boolean(),
      girosPorAtendimento: z.number().int().min(0).max(10),
      giroGratisDias: z.number().int().min(0).max(365),
      bonusAssinantePct: z.number().int().min(0).max(200),
      validadeDias: z.number().int().min(1).max(365),
    }),
    premios: z.array(zPremio).min(2).max(30),
  }));
  return NextResponse.json(await salvarRoleta(s, b.config, b.premios));
});
