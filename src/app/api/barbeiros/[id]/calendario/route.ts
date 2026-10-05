import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { exigirConfigBarbeiro, exigirSessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { urlPainel } from "@/lib/dominios";
import { naoEncontrado, rota } from "@/lib/erros";

function links(token: string) {
  const https = `${urlPainel()}/api/calendario/${token}.ics`;
  const webcal = https.replace(/^https?:/, "webcal:");
  return {
    ics: https,
    webcal,
    google: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`,
    // O Google so consegue ler links publicos (https); em localhost nao funciona.
    publico: /^https:\/\//.test(https) && !/localhost|127\.0\.0\.1/.test(https),
  };
}

/** Link do calendario do barbeiro (cria na primeira vez). So o dono ou o proprio barbeiro. */
export const GET = rota(async (_req: Request, ctx: RouteContext<"/api/barbeiros/[id]/calendario">) => {
  const s = await exigirSessao();
  const { id } = await ctx.params;
  exigirConfigBarbeiro(s, id);
  let b = await db.barbeiro.findUnique({ where: { id }, select: { tokenCalendario: true } });
  if (!b) throw naoEncontrado("Barbeiro");
  if (!b.tokenCalendario) b = await db.barbeiro.update({ where: { id }, data: { tokenCalendario: randomBytes(24).toString("base64url") }, select: { tokenCalendario: true } });
  return NextResponse.json(links(b.tokenCalendario!));
});

/** Troca o codigo (o link antigo para de funcionar: use se ele vazou). */
export const POST = rota(async (_req: Request, ctx: RouteContext<"/api/barbeiros/[id]/calendario">) => {
  const s = await exigirSessao();
  const { id } = await ctx.params;
  exigirConfigBarbeiro(s, id);
  const b = await db.barbeiro.update({ where: { id }, data: { tokenCalendario: randomBytes(24).toString("base64url") }, select: { tokenCalendario: true } });
  return NextResponse.json(links(b.tokenCalendario!));
});
