import { NextResponse } from "next/server";
import { z } from "zod";
import { GESTAO, exigirSessao } from "@/lib/auth/sessao";
import { rota } from "@/lib/erros";
import { zPremio } from "@/lib/jogos/esquema";
import { simularJogo } from "@/lib/jogos/painel";
import { corpo } from "@/lib/validacao";

/** Simulacao de distribuicao antes de publicar (nao grava nada). */
export const POST = rota(async (req: Request) => {
  await exigirSessao(GESTAO);
  const b = await corpo(req, z.object({
    tipo: z.enum(["ROLETA", "CAIXA", "RASPADINHA"]),
    premiosPorJogada: z.number().int().min(1).max(5),
    jogadas: z.number().int().min(100).max(100_000),
    premios: z.array(zPremio.extend({ id: z.string().min(1).max(40) })).min(1).max(30),
  }));
  return NextResponse.json(simularJogo(b.tipo, b.premiosPorJogada, b.premios, b.jogadas));
});
