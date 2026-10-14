import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirSessao, GESTAO } from "@/lib/auth/sessao";
import { MENSAGEM_PADRAO } from "@/lib/campanhas/regras";
import { criarCampanha, listarCampanhas, resumoSegmentos } from "@/lib/campanhas/servico";
import { rota } from "@/lib/erros";
import { corpo } from "@/lib/validacao";

export const dynamic = "force-dynamic";

/** Segmentos da base (tamanhos) e campanhas com os numeros de cada uma. */
export const GET = rota(async () => {
  await exigirSessao(GESTAO);
  const [segmentos, campanhas] = await Promise.all([resumoSegmentos(), listarCampanhas()]);
  return NextResponse.json({ ...segmentos, campanhas, mensagemPadrao: MENSAGEM_PADRAO });
});

export const POST = rota(async (req: Request) => {
  const s = await exigirSessao(GESTAO);
  const b = await corpo(req, z.object({
    nome: z.string().trim().min(2).max(80),
    segmentos: z.array(z.string().max(20)).min(1).max(10),
    mensagem: z.string().trim().min(10).max(900),
    limiteDiario: z.number().int().min(1).max(500),
    taxaRespostaBps: z.number().int().min(100).max(10_000),
  }));
  return NextResponse.json(await criarCampanha(s, b), { status: 201 });
});
