import { NextResponse } from "next/server";
import { rota, ErroNegocio } from "@/lib/erros";
import { limitar } from "@/lib/limite";
import { zCandidatura } from "@/lib/recrutamento/regras";
import { receberCandidatura } from "@/lib/recrutamento/servico";
export const POST = rota(async (req: Request, ctx: { params: Promise<{ vagaId: string }> }) => {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim().slice(0, 64) || "sem-ip";
  limitar(`recrutamento:${ip}`, 10, 60_000);
  const reader = req.body?.getReader();
  if (!reader) throw new ErroNegocio("Formulário vazio.", 400);
  const partes: Uint8Array[] = []; let tamanho = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    tamanho += value.length;
    if (tamanho > 20_000) { await reader.cancel(); throw new ErroNegocio("Formulário muito grande.", 413); }
    partes.push(value);
  }
  let json: unknown;
  try { json = JSON.parse(Buffer.concat(partes).toString("utf8")); } catch { throw new ErroNegocio("Formulário inválido.", 400); }
  await receberCandidatura((await ctx.params).vagaId, zCandidatura.parse(json));
  return NextResponse.json({ recebido: true }, { status: 201, headers: { "Cache-Control": "no-store" } });
});
