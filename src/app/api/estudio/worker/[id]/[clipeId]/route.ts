import { db } from "@/lib/db";
import { naoEncontrado, rota } from "@/lib/erros";
import { exigirWorker } from "@/lib/estudio/http";
import type { Snapshot } from "@/lib/estudio/regras";
import { exigirLease } from "@/lib/estudio/servico";
import { transmitir } from "@/lib/estudio/arquivos";
export const runtime = "nodejs";
export const GET = rota(async (req: Request, ctx: { params: Promise<{ id: string; clipeId: string }> }) => {
  exigirWorker(req);
  const { id, clipeId } = await ctx.params;
  const v = await exigirLease(db, id, req.headers.get("x-estudio-lease") || "");
  if (!(v.snapshot as Snapshot).clipes.some(c => c.id === clipeId)) throw naoEncontrado("Clipe");
  const c = await db.estudioClipe.findFirst({ where: { id: clipeId, projetoId: v.projetoId } });
  if (!c?.arquivo) throw naoEncontrado("Clipe");
  return transmitir(req, c.arquivo, c.mime);
});
