import { NextResponse } from "next/server";
import { rota, ErroNegocio } from "@/lib/erros";
import { limitar } from "@/lib/limite";
import { zCandidatura } from "@/lib/recrutamento/regras";
import { receberCandidatura } from "@/lib/recrutamento/servico";
export const POST = rota(async (req: Request, ctx: { params: Promise<{ vagaId: string }> }) => {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim().slice(0, 64) || "sem-ip";
  const { vagaId } = await ctx.params;
  limitar(`recrutamento:${ip}`, 5, 60_000);
  limitar(`recrutamento-hora:${ip}`, 20, 3_600_000);
  // Teto por vaga, independente do IP (cabecalho pode ser forjado ou o robo trocar de IP).
  limitar(`recrutamento-vaga:${vagaId.slice(0, 40)}`, 100, 3_600_000);
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
  const { site, ...candidatura } = zCandidatura.parse(json);
  // Robo preencheu o campo-isca: responde igual a um envio aceito, sem gravar.
  if (!site) await receberCandidatura(vagaId, candidatura);
  return NextResponse.json({ recebido: true }, { status: 201, headers: { "Cache-Control": "no-store" } });
});
