import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirSessao } from "@/lib/auth/sessao";
import { aplicarHistorico } from "@/lib/conciliacao/historico/aplicar";
import { consultarHistorico, preverHistorico } from "@/lib/conciliacao/historico/consulta";
import { zAplicarHistorico, zEscolhaHistorico, zTransacaoId } from "@/lib/conciliacao/historico/schemas";
import { urlPainel } from "@/lib/dominios";
import { ErroNegocio, rota } from "@/lib/erros";
import { corpo, parametros } from "@/lib/validacao";

export const GET = rota(async (req: Request) => {
  await exigirSessao(["DONO"]);
  const p = parametros(req, z.object({ transacaoId: zTransacaoId, clienteId: z.string().min(1).max(100).optional() }).strict());
  return NextResponse.json(await consultarHistorico(p.transacaoId, p.clienteId), { headers: { "Cache-Control": "private, no-store" } });
});

const zAcao = z.discriminatedUnion("acao", [
  z.object({ acao: z.literal("prever"), escolha: zEscolhaHistorico }).strict(),
  z.object({ acao: z.literal("aplicar"), escolha: zAplicarHistorico }).strict(),
]);
export const POST = rota(async (req: Request) => {
  const s = await exigirSessao(["DONO"]);
  const origin = req.headers.get("origin");
  if (req.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== new URL(urlPainel()).origin)) throw new ErroNegocio("Origem da solicitação inválida.", 403);
  if (!req.headers.get("content-type")?.startsWith("application/json")) throw new ErroNegocio("Envie os dados como JSON.", 415);
  const p = await corpo(req, zAcao);
  return NextResponse.json(p.acao === "prever" ? await preverHistorico(p.escolha) : await aplicarHistorico(s, p.escolha), { headers: { "Cache-Control": "private, no-store" } });
});
