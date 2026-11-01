import { z } from "zod";
import { db } from "@/lib/db";
import { naoEncontrado, rota } from "@/lib/erros";
import { equipe, json, resposta } from "@/lib/estudio/http";
import { LIMITES, zRevisao } from "@/lib/estudio/regras";
import { concluirUpload, excluirClipe, iniciarUpload, projeto } from "@/lib/estudio/servico";
import { apagar, receber, transmitir } from "@/lib/estudio/arquivos";
export const runtime = "nodejs";
export const maxDuration = 300;
type Contexto = { params: Promise<{ id: string; clipeId: string }> };
export const GET = rota(async (req: Request, ctx: Contexto) => {
  const s = await equipe(req); const { id, clipeId } = await ctx.params;
  const p = await projeto(db, s.usuarioId, id);
  const c = p.clipes.find(c => c.id === clipeId);
  if (!c?.arquivo) throw naoEncontrado("Vídeo");
  return transmitir(req, c.arquivo, c.mime);
});
export const PUT = rota(async (req: Request, ctx: Contexto) => {
  const s = await equipe(req); const { id, clipeId } = await ctx.params;
  const c = await iniciarUpload(s.usuarioId, id, clipeId);
  let arquivo: string | undefined;
  try {
    arquivo = (await receber(req, c.bytes, LIMITES.arquivo, c.mime)).chave;
    await concluirUpload(s.usuarioId, id, clipeId, c.uploadEm, arquivo);
    return resposta({ ok: true });
  } catch (e) {
    if (arquivo) await apagar(arquivo);
    throw e;
  } finally {
    await db.estudioClipe.updateMany({ where: { id: clipeId, uploadEm: c.uploadEm, arquivo: null }, data: { uploadEm: null } });
  }
});
export const DELETE = rota(async (req: Request, ctx: Contexto) => {
  const s = await equipe(req); const { id, clipeId } = await ctx.params;
  await excluirClipe(s.usuarioId, id, clipeId, (await json(req, z.object({ revisao: zRevisao }))).revisao);
  return resposta({ ok: true });
});
