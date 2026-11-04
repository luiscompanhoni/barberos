import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirSessaoCom } from "@/lib/auth/permissoes";
import { urlPainel } from "@/lib/dominios";
import { proibido, rota } from "@/lib/erros";
import { json } from "@/lib/estudio/http";
import { previaLotePix, prepararLotePix } from "@/lib/rh/lote-pix";
import { zCompetenciaPix, zRevisaoPix } from "@/lib/rh/lote-pix-regras";
import { parametros } from "@/lib/validacao";

export const dynamic = "force-dynamic";
const resposta = (dados: unknown) => NextResponse.json(dados, { headers: { "cache-control": "private, no-store" } });
export const GET = rota(async (req: Request) => {
  const s = await exigirSessaoCom("folha");
  const q = parametros(req, z.object({ competencia: zCompetenciaPix }).strict());
  return resposta(await previaLotePix(s, q.competencia));
});
export const POST = rota(async (req: Request) => {
  const s = await exigirSessaoCom("folha");
  const origin = req.headers.get("origin");
  if (req.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== new URL(urlPainel()).origin)) throw proibido();
  const d = await json(req, z.object({ competencia: zCompetenciaPix, revisao: zRevisaoPix, acao: z.enum(["preparar", "conferir"]) }).strict());
  return resposta(await prepararLotePix(s, d));
});
