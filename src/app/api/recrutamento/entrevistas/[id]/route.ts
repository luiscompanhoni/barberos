import { NextResponse } from "next/server";
import { z } from "zod";
import { exigirSessao } from "@/lib/auth/sessao";
import { rota } from "@/lib/erros";
import { corpoEntrevista } from "@/lib/recrutamento/entrevistas-http";
import { gerirEntrevista } from "@/lib/recrutamento/entrevistas-gestao";
export const POST = rota(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const s = await exigirSessao(["DONO"]);
  const b = await corpoEntrevista(req, z.object({ versao: z.number().int().min(0), acao: z.enum(["CANCELAR", "RENOVAR"]) }).strict());
  await gerirEntrevista(s.usuarioId, (await ctx.params).id, b.versao, b.acao);
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
});
