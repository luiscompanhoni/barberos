import { rota } from "@/lib/erros";
import { json, resposta } from "@/lib/estudio/http";
import { exigirAgentes } from "@/lib/agentes/acesso";
import { zAcaoExecucao } from "@/lib/agentes/regras";
import { decidirExecucao } from "@/lib/agentes/servico";
export const POST = rota(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const s = await exigirAgentes(req), { id } = await ctx.params;
  return resposta(await decidirExecucao(s.usuarioId, id, await json(req, zAcaoExecucao)));
});
