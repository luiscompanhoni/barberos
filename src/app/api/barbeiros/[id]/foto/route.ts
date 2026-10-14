import { NextResponse } from "next/server";
import { z } from "zod";
import { auditar } from "@/lib/auditoria";
import { GESTAO, type Sessao, exigirSessao } from "@/lib/auth/sessao";
import { db } from "@/lib/db";
import { ErroNegocio, naoEncontrado, proibido, rota } from "@/lib/erros";
import { publicar } from "@/lib/eventos";
import { corpo } from "@/lib/validacao";

const TIPOS = ["image/webp", "image/jpeg", "image/png"];
const MAX_BYTES = 400 * 1024;

/** Foto publica (a area do cliente usa). A URL leva ?v=<fotoVersao>, entao o cache e eterno. */
export const GET = rota(async (_req: Request, ctx: RouteContext<"/api/barbeiros/[id]/foto">) => {
  const { id } = await ctx.params;
  const b = await db.barbeiro.findUnique({ where: { id }, select: { fotoDados: true, fotoTipo: true } });
  if (!b?.fotoDados || !b.fotoTipo) throw naoEncontrado("Foto");
  return new Response(new Uint8Array(b.fotoDados), {
    headers: {
      "Content-Type": b.fotoTipo,
      "Content-Length": String(b.fotoDados.length),
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

/** Dono e gerente trocam a foto de qualquer um; barbeiro so a propria. */
async function exigirPermissao(id: string): Promise<Sessao> {
  const s = await exigirSessao([...GESTAO, "BARBEIRO"]);
  if (s.papel === "BARBEIRO" && s.barbeiroId !== id) throw proibido();
  return s;
}

export const PUT = rota(async (req: Request, ctx: RouteContext<"/api/barbeiros/[id]/foto">) => {
  const { id } = await ctx.params;
  const s = await exigirPermissao(id);
  const { dataUrl } = await corpo(req, z.object({ dataUrl: z.string().max(800_000) }));
  const m = /^data:(image\/(?:webp|jpeg|png));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!m || !TIPOS.includes(m[1])) throw new ErroNegocio("Envie uma imagem WebP, JPEG ou PNG.", 400, "foto_tipo");
  const dados = Buffer.from(m[2], "base64");
  if (dados.length === 0) throw new ErroNegocio("Imagem vazia.", 400, "foto_vazia");
  if (dados.length > MAX_BYTES) throw new ErroNegocio("A foto passou de 400 KB.", 413, "foto_grande");

  const b = await db.$transaction(async (tx) => {
    const atual = await tx.barbeiro.findUnique({ where: { id }, select: { fotoVersao: true } });
    if (!atual) throw naoEncontrado("Barbeiro");
    const novo = await tx.barbeiro.update({
      where: { id },
      data: { fotoDados: dados, fotoTipo: m[1], fotoVersao: Math.abs(atual.fotoVersao) + 1 },
      select: { id: true, fotoVersao: true },
    });
    await auditar(tx, s.usuarioId, "foto_trocar", "barbeiro", id, { bytes: dados.length, tipo: m[1], versao: novo.fotoVersao });
    return novo;
  });
  publicar({ tipo: "agenda", barbeiroIds: [id], datas: [] });
  return NextResponse.json(b);
});

export const DELETE = rota(async (_req: Request, ctx: RouteContext<"/api/barbeiros/[id]/foto">) => {
  const { id } = await ctx.params;
  const s = await exigirPermissao(id);
  const b = await db.$transaction(async (tx) => {
    const atual = await tx.barbeiro.findUnique({ where: { id }, select: { fotoVersao: true } });
    if (!atual) throw naoEncontrado("Barbeiro");
    // Versao negativa = sem foto (telas mostram as iniciais), sem nunca repetir
    // um ?v= ja cacheado como immutable quando vier a proxima foto.
    const novo = await tx.barbeiro.update({
      where: { id },
      data: { fotoDados: null, fotoTipo: null, fotoVersao: -(Math.abs(atual.fotoVersao) + 1) },
      select: { id: true, fotoVersao: true },
    });
    await auditar(tx, s.usuarioId, "foto_remover", "barbeiro", id);
    return novo;
  });
  publicar({ tipo: "agenda", barbeiroIds: [id], datas: [] });
  return NextResponse.json(b);
});
