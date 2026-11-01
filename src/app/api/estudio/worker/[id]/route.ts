import { db } from "@/lib/db";
import { rota } from "@/lib/erros";
import { exigirWorker, resposta } from "@/lib/estudio/http";
import { LIMITES } from "@/lib/estudio/regras";
import { exigirLease, finalizar } from "@/lib/estudio/servico";
import { apagar, receber } from "@/lib/estudio/arquivos";
export const runtime = "nodejs";
export const maxDuration = 300;
export const PUT = rota(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  exigirWorker(req);
  const { id } = await ctx.params; const lease = req.headers.get("x-estudio-lease") || "";
  await exigirLease(db, id, lease);
  const arquivo = await receber(req, null, LIMITES.saida, "video/mp4");
  try { await finalizar(id, lease, arquivo); }
  catch (e) { await apagar(arquivo.chave); throw e; }
  return resposta({ ok: true });
});
