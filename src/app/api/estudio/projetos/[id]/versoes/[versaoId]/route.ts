import { z } from "zod";
import { db } from "@/lib/db";
import { naoEncontrado, rota } from "@/lib/erros";
import { equipe, json, resposta } from "@/lib/estudio/http";
import { zRevisao } from "@/lib/estudio/regras";
import { avaliar, projeto } from "@/lib/estudio/servico";
import { transmitir } from "@/lib/estudio/arquivos";
export const runtime = "nodejs";
type Contexto = { params: Promise<{ id: string; versaoId: string }> };
export const GET = rota(async (req: Request, ctx: Contexto) => {
  const s = await equipe(req); const { id, versaoId } = await ctx.params;
  const p = await projeto(db, s.usuarioId, id);
  const v = p.versoes.find(v => v.id === versaoId);
  if (!v?.arquivo) throw naoEncontrado("Versão");
  return transmitir(req, v.arquivo, "video/mp4", new URL(req.url).searchParams.get("download") === "1");
});
export const POST = rota(async (req: Request, ctx: Contexto) => {
  const s = await equipe(req); const { id, versaoId } = await ctx.params;
  const e = await json(req, z.object({ revisao: zRevisao, acao: z.enum(["aprovar", "ajustes", "cancelar"]), comentario: z.string().trim().max(1000).optional() }));
  await avaliar(s.usuarioId, id, versaoId, e.revisao, e.acao, e.comentario);
  return resposta({ ok: true });
});
