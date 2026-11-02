import { rota } from "@/lib/erros";
import { json, resposta } from "@/lib/estudio/http";
import { exigirAgentes } from "@/lib/agentes/acesso";
import { zAlterarRotina } from "@/lib/agentes/regras";
import { alterarRotinaAgente } from "@/lib/agentes/rotinas";
export const PATCH = rota(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const s = await exigirAgentes(req), { id } = await ctx.params;
  return resposta(await alterarRotinaAgente(s.usuarioId, id, await json(req, zAlterarRotina)));
});
