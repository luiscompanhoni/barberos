import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirSessao } from "@/lib/auth/sessao";
import { ajustarPontos, classificacao } from "@/lib/checklist/pontos";
import { rota } from "@/lib/erros";
import { corpo } from "@/lib/validacao";

export const dynamic = "force-dynamic";

/** Classificacao da equipe (pontos, faixa e progresso). */
export const GET = rota(async () => {
  await exigirSessao(["DONO", "RECEPCAO"]);
  return NextResponse.json(await classificacao());
});

/** Ajuste manual de pontos, com motivo. */
export const POST = rota(async (req: Request) => {
  const s = await exigirSessao(["DONO", "RECEPCAO"]);
  const b = await corpo(req, z.object({
    pessoaId: z.string().max(40),
    pontos: z.number().int().min(-10000).max(10000).refine((n) => n !== 0, "Pontos não pode ser zero"),
    motivo: z.string().trim().min(3).max(200),
  }));
  await ajustarPontos(s, b.pessoaId, b.pontos, b.motivo);
  return NextResponse.json({ ok: true });
});
